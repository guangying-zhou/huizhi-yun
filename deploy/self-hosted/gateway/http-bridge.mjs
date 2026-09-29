// Node HTTP <-> Worker Web API bridge for the public ingress (cloudflared or
// nginx-over-Tailscale target).
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable, Transform } from 'node:stream'
import { safeName } from './log.mjs'

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'http2-settings'])
// Forwarding facts are recomputed by the Worker from the configured public URL.
const CLIENT_FORWARDING = new Set(['host', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port',
  'x-forwarded-prefix', 'x-real-ip'])
// Client-address claims. Always stripped in tailnet mode, where the gateway
// sets its own audit value (see `auditClientAddress`); the loopback
// (cloudflared) mode keeps its historical pass-through.
const CLIENT_ADDRESS_CLAIMS = new Set(['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip',
  'x-client-ip', 'x-cluster-client-ip', 'client-ip'])
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])
const WEBSOCKET_HANDSHAKE = ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions']
const WEBSOCKET_HANDSHAKE_TIMEOUT_MS = 10_000

class BodyTooLargeError extends Error {
  constructor() {
    super('request body too large')
    this.name = 'BodyTooLargeError'
  }
}

/**
 * Remove hop-by-hop headers, every client-supplied `x-hzy-*` header and all
 * client forwarding claims. Nothing here re-adds trusted context; the Worker's
 * `buildForwardHeaders` derives it from the verified registry answer.
 */
export function sanitizeClientHeaders(rawHeaders, { stripClientAddress = false } = {}) {
  const headers = new Headers()
  const pairs = []
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) pairs.push([rawHeaders[index], rawHeaders[index + 1]])
  const connectionTokens = new Set()
  for (const [name, value] of pairs) {
    if (name.toLowerCase() === 'connection') {
      for (const token of String(value).split(',')) connectionTokens.add(token.trim().toLowerCase())
    }
  }
  for (const [name, value] of pairs) {
    const key = name.toLowerCase()
    if (HOP_BY_HOP.has(key) || connectionTokens.has(key) || CLIENT_FORWARDING.has(key) || key.startsWith('x-hzy-')) continue
    if (stripClientAddress && CLIENT_ADDRESS_CLAIMS.has(key)) continue
    try { headers.append(key, value) } catch { /* invalid header value is dropped */ }
  }
  return headers
}

function hostMatches(hostHeader, publicHost) {
  const host = String(hostHeader || '').trim().toLowerCase()
  return host === publicHost || host === `${publicHost}:443`
}

function publicUrl(req, publicHost) {
  const target = String(req.url || '')
  // Only origin-form targets; absolute-form and scheme-relative targets are refused.
  if (!target.startsWith('/') || target.startsWith('//')) return null
  const url = new URL(target, `https://${publicHost}`)
  return url.host === publicHost ? url : null
}

function plain(res, status, text) {
  if (res.headersSent) return res.destroy()
  res.writeHead(status, { 'content-type': 'text/plain;charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(text)
}

function countingStream(limit, onTooLarge) {
  let total = 0
  return new Transform({
    transform(chunk, encoding, callback) {
      total += chunk.length
      if (total > limit) {
        onTooLarge()
        callback(new BodyTooLargeError())
        return
      }
      callback(null, chunk)
    }
  })
}

/** Write a Web Response to a Node response, streaming the body. */
export async function writeWebResponse(response, req, res) {
  const headers = {}
  const connectionTokens = new Set(String(response.headers.get('connection') || '').split(',').map(item => item.trim().toLowerCase()))
  for (const [name, value] of response.headers) {
    const key = name.toLowerCase()
    if (key === 'set-cookie' || HOP_BY_HOP.has(key) || connectionTokens.has(key)) continue
    // Upstream diagnostic x-hzy-* headers never reach the browser; the Worker's
    // own `x-hzy-gateway` marker is kept.
    if (key.startsWith('x-hzy-') && key !== 'x-hzy-gateway') continue
    headers[key] = value
  }
  const cookies = response.headers.getSetCookie?.() || []
  if (cookies.length) headers['set-cookie'] = cookies
  const noBody = req.method === 'HEAD' || NULL_BODY_STATUSES.has(response.status) || !response.body
  res.writeHead(response.status, response.statusText || undefined, headers)
  if (noBody) {
    await response.body?.cancel().catch(() => {})
    res.end()
    return
  }
  const body = Readable.fromWeb(response.body)
  await new Promise((resolve) => {
    const finish = () => resolve()
    body.once('error', () => { res.destroy(); finish() })
    res.once('close', () => { body.destroy(); finish() })
    res.once('finish', finish)
    body.pipe(res)
  })
}

/**
 * Credential-free Codocs editor shell (GET/HEAD only). Under the Enterprise
 * pilot the Worker sends every `/codocs/*` page to the Enterprise Host; the
 * iframe editor SPA and its build assets stay on the Codocs process. No cookie,
 * authorization or gateway credential crosses this route.
 */
export function isCodocsEditorShellPath(pathname) {
  return /^\/codocs\/embed\/editor\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(pathname)
    || /^\/codocs\/(?:_nuxt|fonts|pdfjs)\/[A-Za-z0-9._\-/]{1,256}$/.test(pathname) && !pathname.split('/').some(part => part === '..' || part === '.')
    || /^\/codocs\/api\/_nuxt_icon\/[a-z0-9-]+(?:\.json)?$/.test(pathname)
    || pathname === '/codocs/favicon.png'
}

async function proxyCodocsEditorShell(url, req, res, { codocsBinding }) {
  if (!['GET', 'HEAD'].includes(req.method)) return plain(res, 405, 'Method Not Allowed')
  const accept = typeof req.headers.accept === 'string' ? req.headers.accept.slice(0, 512) : '*/*'
  const upstream = await codocsBinding.fetch(url.toString(), {
    method: req.method, headers: { accept }, redirect: 'manual'
  })
  if (upstream.status !== 200) {
    await upstream.body?.cancel().catch(() => {})
    return upstream.status === 404 ? plain(res, 404, 'Not Found') : plain(res, 502, 'Bad Gateway')
  }
  const headers = new Headers({
    'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
    'cache-control': url.pathname.startsWith('/codocs/_nuxt/') ? 'public, max-age=31536000, immutable' : 'no-store',
    'x-content-type-options': 'nosniff',
    'x-hzy-gateway': 'tenant-gateway'
  })
  await writeWebResponse(new Response(upstream.body, { status: 200, headers }), req, res)
}

/**
 * Public ingress request handler. Only the configured public host is served;
 * the URL is always rebuilt as https://<publicHost><path> (cloudflared or
 * nginx terminates TLS), so the Worker never sees a client-chosen scheme or
 * host. With a `peerGuard` (tailnet mode) a non-allowlisted socket is
 * destroyed again here as defence in depth, client-address claims are
 * stripped, and `clientAddressFor(req)` supplies the only audit address the
 * apps see (x-forwarded-for / x-real-ip). No decision here depends on it.
 */
export function createIngressHandler({ worker, env, config, log, codocsBinding = null, peerGuard = null, clientAddressFor = null }) {
  const { publicHost } = config.site
  const { maxRequestBodyBytes } = config.limits
  const editorShell = Boolean(codocsBinding) && (config.enterprise.pilot || config.enterprise.authPilot)
  const context = { waitUntil(promise) { Promise.resolve(promise).catch(() => {}) }, passThroughOnException() {} }

  return async function handle(req, res) {
    if (peerGuard?.check(req.socket)) return
    if (!hostMatches(req.headers.host, publicHost)) return plain(res, 421, 'Misdirected Request')
    const url = publicUrl(req, publicHost)
    if (!url) return plain(res, 400, 'Bad Request')
    const declared = Number(req.headers['content-length'] || 0)
    if (Number.isFinite(declared) && declared > maxRequestBodyBytes) {
      req.resume()
      return plain(res, 413, 'Payload Too Large')
    }
    // Real upgrades are handled by createUpgradeHandler and never reach this
    // handler. A plain request to the collaboration socket is answered here so
    // the standalone Collab (whose HTTP root is a welcome page) is not exposed
    // and the response matches the Worker/Durable Object contract: 426.
    if (url.pathname === '/codocs/ws') {
      req.resume()
      if (res.headersSent) return res.destroy()
      res.writeHead(426, { 'content-type': 'text/plain;charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        upgrade: 'websocket', connection: 'Upgrade' })
      return res.end('Upgrade Required')
    }
    let tooLarge = false
    try {
      if (editorShell && isCodocsEditorShellPath(url.pathname)) {
        req.resume()
        await proxyCodocsEditorShell(url, req, res, { codocsBinding })
        return
      }
      const headers = sanitizeClientHeaders(req.rawHeaders, { stripClientAddress: Boolean(clientAddressFor) })
      const clientAddress = clientAddressFor?.(req)
      if (clientAddress) {
        headers.set('x-forwarded-for', clientAddress)
        headers.set('x-real-ip', clientAddress)
      }
      const hasBody = !['GET', 'HEAD'].includes(req.method)
      const abort = new AbortController()
      res.once('close', () => { if (!res.writableFinished) abort.abort() })
      const body = hasBody
        ? Readable.toWeb(req.pipe(countingStream(maxRequestBodyBytes, () => { tooLarge = true })))
        : undefined
      if (!hasBody) req.resume()
      const request = new Request(url, { method: req.method, headers, body, duplex: hasBody ? 'half' : undefined, signal: abort.signal })
      const response = await worker.fetch(request, env, context)
      await writeWebResponse(response, req, res)
    } catch (error) {
      if (tooLarge) return plain(res, 413, 'Payload Too Large')
      log('gateway-request-failed', { method: safeMethod(req.method), errorName: safeName(error?.name) })
      plain(res, 502, 'Bad Gateway')
    }
  }
}

/**
 * WebSocket upgrade passthrough. Workers answer with a WebSocketPair; under
 * Node the equivalent is a verified raw socket splice after the upstream
 * returns 101. Only the collaboration paths the Worker routes to Collab are
 * accepted, only from the configured public origin, and the upstream receives
 * handshake headers plus gateway-derived routing context — never cookies,
 * authorization or the gateway credential (Collab authenticates with the
 * one-time ticket in its first frame).
 */
export function createUpgradeHandler({ config, log, peerGuard = null }) {
  const { publicHost, tenantCode, environment } = config.site
  const collab = config.apps.collab
  const { maxWebSockets, webSocketIdleTimeoutMs } = config.limits
  let active = 0

  const reject = (socket, status, text) => {
    if (!socket.writable) return socket.destroy()
    socket.end(`HTTP/1.1 ${status} ${text}\r\nconnection: close\r\ncontent-length: 0\r\ncache-control: no-store\r\n\r\n`)
  }

  const handler = function handleUpgrade(req, socket, head) {
    socket.on('error', () => socket.destroy())
    if (peerGuard?.check(socket)) return
    if (!hostMatches(req.headers.host, publicHost)) return reject(socket, 421, 'Misdirected Request')
    const url = publicUrl(req, publicHost)
    if (!url) return reject(socket, 400, 'Bad Request')
    if (req.method !== 'GET' || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') return reject(socket, 400, 'Bad Request')
    if (!collab || !(url.pathname === '/codocs/ws' || url.pathname.startsWith('/collab/'))) return reject(socket, 404, 'Not Found')
    if (req.headers.origin !== `https://${publicHost}`) return reject(socket, 403, 'Forbidden')
    if (active >= maxWebSockets) return reject(socket, 503, 'Service Unavailable')

    const target = new URL(collab.origin)
    const headers = {
      connection: 'Upgrade',
      upgrade: 'websocket',
      host: target.host,
      origin: `https://${publicHost}`,
      'x-forwarded-host': publicHost,
      'x-forwarded-proto': 'https',
      'x-forwarded-port': '443',
      'x-hzy-tenant': tenantCode,
      'x-hzy-environment': environment,
      'x-hzy-app-code': 'collab'
    }
    for (const name of WEBSOCKET_HANDSHAKE) {
      const value = req.headers[name]
      if (typeof value === 'string' && value.length <= 1024) headers[name] = value
    }
    if (typeof req.headers['user-agent'] === 'string') headers['user-agent'] = req.headers['user-agent'].slice(0, 512)

    active += 1
    let released = false
    const release = () => { if (!released) { released = true; active -= 1 } }
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest
    const upstream = send({
      host: target.hostname.replace(/^\[|\]$/g, ''),
      port: target.port,
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      headers
    })
    upstream.setTimeout(WEBSOCKET_HANDSHAKE_TIMEOUT_MS, () => upstream.destroy(new Error('handshake timeout')))
    socket.once('close', () => { release(); upstream.destroy() })
    upstream.once('error', () => { release(); reject(socket, 502, 'Bad Gateway') })
    upstream.once('response', (response) => {
      response.resume()
      release()
      reject(socket, response.statusCode >= 400 ? response.statusCode : 502, 'Upgrade Refused')
    })
    upstream.once('upgrade', (response, peer, upstreamHead) => {
      upstream.setTimeout(0)
      const lines = []
      for (let index = 0; index + 1 < response.rawHeaders.length; index += 2) {
        const name = response.rawHeaders[index]
        const key = name.toLowerCase()
        if (['connection', 'upgrade', 'set-cookie', 'content-length', 'transfer-encoding'].includes(key) || key.startsWith('x-hzy-')) continue
        lines.push(`${name}: ${response.rawHeaders[index + 1]}`)
      }
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n${lines.join('\r\n')}${lines.length ? '\r\n' : ''}\r\n`)
      if (upstreamHead?.length) socket.write(upstreamHead)
      if (head?.length) peer.write(head)
      socket.setTimeout(webSocketIdleTimeoutMs, () => socket.destroy())
      peer.setTimeout(webSocketIdleTimeoutMs, () => peer.destroy())
      // HTTP server sockets allow half-open connections; a WebSocket has no
      // use for half-close, so either side ending tears down both.
      const teardown = () => { socket.destroy(); peer.destroy() }
      peer.on('error', teardown)
      peer.once('end', teardown)
      peer.once('close', teardown)
      socket.once('end', teardown)
      socket.once('close', teardown)
      socket.pipe(peer).pipe(socket)
    })
    upstream.end()
  }
  handler.activeCount = () => active
  return handler
}

function safeMethod(method) {
  return /^[A-Z]{1,16}$/.test(String(method || '')) ? method : 'OTHER'
}
