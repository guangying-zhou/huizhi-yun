import { createServer, request as httpRequest } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { buildForwardHeaders } from '../../cloudflare/tenant-gateway/src/index.js'
import { resolveEnterprisePilotPath } from '../enterprise-topology.mjs'
import { safeError, safeErrorHeaders, safeCorrelationId, wantsNavigationHtml, navigationErrorHtml } from './error-contract.mjs'
import { consoleFacadeRoute, allowedPublicFacadeToken } from './console-facade.mjs'
import { runtimeDialEndpoint } from './runtime-transport.mjs'
import { readCollabClientSecret } from './collab-credentials.mjs'

const PUBLIC_HOST = 'hzy0.isme.dev'
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length'
])
const INTERNAL_PATH = /^\/(?:(?:(?:enterprise|aims|assets|codocs)\/)?api\/internal|_nitro\/tasks)(?:\/|$)/
const INTERNAL_PATH_REJECTION = Symbol('internal-path-rejection')
const HTTP_TIMEOUT_MS = 120_000
const WS_HANDSHAKE_TIMEOUT_MS = 10_000
const WS_IDLE_TIMEOUT_MS = 60_000
const DEV_DEPS_PREFIX = `/enterprise/_nuxt/@fs${encodeURI(fileURLToPath(new URL('../../../enterprise/node_modules/.cache/vite/client/deps/', import.meta.url)))}`

function versionedDevDependency(url) {
  if (!url.pathname.startsWith(DEV_DEPS_PREFIX)) return false
  const file = url.pathname.slice(DEV_DEPS_PREFIX.length)
  if (!/^[\w.-]+\.js$/.test(file)) return false
  // Source transforms and virtual modules have stable URLs across restarts.
  // Only Vite's versioned prebundles / content-hashed chunks are reusable.
  return (url.searchParams.size === 1 && /^[a-f0-9]{8}$/.test(url.searchParams.get('v') || ''))
    || (!url.search && /^chunk-[A-Z0-9]{8}\.js$/.test(file))
}

/**
 * Build the local Enterprise transport without binding a listening socket.
 * The caller owns listen/close, which keeps this helper suitable for isolated tests.
 */
export function createLocalEnterpriseGateway(profile, secret, facade, { collabTokenSecret, collabTokenFetch = fetch } = {}) {
  const listeners = record(profile?.listeners)
  const enterprise = record(listeners.enterprise)
  const codocsEditor = record(listeners.codocsEditor)
  const collab = record(listeners.collab)
  const runtime = record(profile?.runtime)
  const identity = record(profile?.identity)
  const environment = profile?.environment || 'test'
  const workflowLocal = profile.features?.workflowLocal === true
  const env = {
    HZY_CLOUDFLARE_INTERNAL_TOKEN: String(secret || '').trim(),
    ...(workflowLocal ? {
      HZY_AIMS_ORIGIN: `http://127.0.0.1:${listeners.aims.port}`,
      HZY_WORKFLOW_ORIGIN: `http://127.0.0.1:${listeners.workflow.port}`
    } : {})
  }
  const tenant = {
    tenantCode: runtime.expectedTenant,
    deploymentCode: identity.consoleDeployment,
    environment,
    apps: { enterprise: { deploymentCode: identity.enterpriseDeployment },
      ...(workflowLocal ? {
        aims: { deploymentCode: 'C000001-test-aims', basePath: '/aims' },
        workflow: { deploymentCode: 'C000001-test-workflow-local', basePath: '/workflow' }
      } : {}) },
    dataRuntime: {
      endpoint: runtime.canonicalEndpoint,
      runtimeCode: runtime.expectedRuntimeCode,
      audience: 'data-runtime'
    }
  }

  if (!env.HZY_CLOUDFLARE_INTERNAL_TOKEN) throw new Error('gateway secret is required')
  if (!isLoopback(enterprise.host) || !Number.isInteger(enterprise.port)) throw new Error('enterprise listener must be loopback')
  if (codocsEditor.host !== '127.0.0.1' || codocsEditor.port !== 23130) throw new Error('Codocs editor must use the pinned loopback listener')
  if (profile.features?.codocsCollaborationV2 === true
    && (profile.features.codocsSnapshotV2 !== true || !isLoopback(collab.host) || !Number.isInteger(collab.port))) {
    throw new Error('Collab route requires snapshot v2 and a loopback listener')
  }

  const server = createServer((request, response) => proxy(request, response))
  server.on('upgrade', (request, socket, head) => proxyUpgrade(request, socket, head))
  return server

  async function proxy(request, response) {
    let requestUrl
    try {
      if (String(request.url || '').startsWith('/__hzy0/collab-token')) {
        await proxyCollabServiceToken(request, response)
        return
      }
      requestUrl = publicRequestUrl(request)
      if (['/', '/enterprise', '/enterprise/'].includes(requestUrl.pathname)) {
        if (!['GET', 'HEAD'].includes(request.method)) return reply(response, 405)
        if (requestUrl.pathname !== '/enterprise') {
          response.writeHead(302, { location: '/enterprise', 'cache-control': 'no-store' })
          response.end()
          return
        }
      }
      if (isCodocsEditorShellPath(requestUrl.pathname)) {
        await proxyCodocsEditorShell(requestUrl, request, response)
        return
      }
      const route = resolveRoute(requestUrl, request.method)
      if (!route) return reply(response, 404)
      if (route.kind === 'collab') return reply(response, 426)
      if (route.kind === 'redirect') {
        if (!['GET', 'HEAD'].includes(request.method)) return reply(response, 405)
        response.writeHead(requestUrl.pathname.startsWith('/shell/') ? 307 : 308, { location: route.path, 'cache-control': 'no-store' })
        response.end()
        return
      }
      let facadeTokenBody
      if (facade && requestUrl.pathname === '/console/oauth/token') {
        facadeTokenBody = ''
        for await (const chunk of request) {
          facadeTokenBody += chunk
          if (Buffer.byteLength(facadeTokenBody) > 65536) return reply(response, 413)
        }
        // Public callers cannot inherit the Console Gateway identity to mint
        // service tokens. Those remain on authenticated private egress only.
        if (!allowedPublicFacadeToken(facadeTokenBody)) return reply(response, 403)
      }
      const headers = requestUrl.pathname.startsWith('/console/') && facade
        ? await facade.headers(new Request(requestUrl, { method: request.method, headers: sanitizedRequestHeaders(request.headers) }))
        : trustedHeaders(request, requestUrl)
      for (const name of HOP_BY_HOP) headers.delete(name)
      // Dev module URLs can survive a Vite optimizer restart while their
      // transitive ?v= imports change. Never mix cached module generations.
      const devAsset = profile.mode === 'dev' && /^\/(enterprise|console)\/_nuxt\//.test(requestUrl.pathname)
      if (devAsset) {
        headers.delete('if-none-match')
        headers.delete('if-modified-since')
      }
      const upstream = httpRequest(upstreamOptions(request, requestUrl, route.path, headers), upstreamResponse => {
        // Nuxt Dev error pages include incoming headers, including the gateway
        // credential. Never expose upstream diagnostic bodies on this ingress.
        if ((upstreamResponse.statusCode || 502) >= 400) {
          const status = upstreamResponse.statusCode || 502
          // Classify only fixed known diagnostics. Never log the body, stack,
          // request URL/query, headers or arbitrary upstream error messages.
          let diagnostic = '', oversized = false
          upstreamResponse.on('data', chunk => { if (Buffer.byteLength(diagnostic) + chunk.length > 65536) oversized = true; if (!oversized) diagnostic += chunk.toString() })
          upstreamResponse.on('end', () => {
            const known = ['Unapproved Console destination', 'Request input is not supported', 'fetch failed', 'Invalid URL', 'not defined', 'not a function', 'Console service token request failed', 'Console did not return a Bearer access token', 'Console service client is not configured', 'Enterprise runtime is unavailable']
            console.error(JSON.stringify({ event: 'hzy0-upstream-failure', status, categories: known.filter(value => diagnostic.includes(value)) }))
            const safe = safeError(status, upstreamResponse.headers['content-type'], oversized ? '' : diagnostic)
            const navigation = wantsNavigationHtml(request.method, requestUrl.pathname, request.headers)
            response.writeHead(status, { ...safeErrorHeaders(status, upstreamResponse.headers, { allowCookieClear: true }),
              ...(navigation ? { 'content-type': 'text/html; charset=utf-8' } : {}) })
            response.end(request.method === 'HEAD' ? undefined : navigation
              ? navigationErrorHtml(status, safe.data?.correlationId || safeCorrelationId(upstreamResponse.headers['content-type'], oversized ? '' : diagnostic))
              : JSON.stringify(safe))
          })
          upstreamResponse.once('aborted', () => response.destroy())
          upstreamResponse.once('error', () => response.destroy())
          upstreamResponse.resume()
          return
        }
        const output = filteredResponseHeaders(upstreamResponse)
        if (devAsset) {
          const immutableDependency = ['GET', 'HEAD'].includes(request.method)
            && upstreamResponse.statusCode === 200 && !upstreamResponse.headers['set-cookie']
            && /\bimmutable\b/.test(String(upstreamResponse.headers['cache-control'] || ''))
            && versionedDevDependency(requestUrl)
          output['cache-control'] = immutableDependency ? 'private, max-age=31536000, immutable' : 'no-store'
          output['cdn-cache-control'] = 'no-store'
          output['cloudflare-cdn-cache-control'] = 'no-store'
          delete output.etag
          delete output['last-modified']
        }
        response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.statusMessage, output)
        upstreamResponse.pipe(response)
        upstreamResponse.once('error', () => response.destroy())
        upstreamResponse.once('aborted', () => response.destroy())
      })
      upstream.setTimeout(HTTP_TIMEOUT_MS, () => upstream.destroy(new Error('upstream timeout')))
      bindCancellation(request, response, upstream)
      upstream.once('error', () => {
        if (!response.headersSent) replyUpstreamUnavailable(request, requestUrl, response)
        else response.destroy()
      })
      if (facadeTokenBody !== undefined) upstream.end(facadeTokenBody)
      else request.pipe(upstream)
    } catch (error) {
      if (!response.headersSent) {
        if (error === INTERNAL_PATH_REJECTION) reply(response, 404)
        else if (requestUrl) replyUpstreamUnavailable(request, requestUrl, response)
        else reply(response, 503)
      }
      else response.destroy()
    }
  }

  async function proxyCollabServiceToken(request, response) {
    const noStore = { 'content-type': 'application/json', 'cache-control': 'no-store' }
    const fail = status => { response.writeHead(status, noStore); response.end(JSON.stringify({ statusCode: status })) }
    const address = request.socket.remoteAddress
    const port = server.address()?.port
    if (request.url !== '/__hzy0/collab-token' || request.method !== 'POST'
      || profile.features?.codocsCollaborationV2 !== true || !facade
      || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
      || request.headers.host !== `127.0.0.1:${port}` || request.headers.origin
      || !String(request.headers['content-type'] || '').startsWith('application/json')) return fail(404)
    let body = ''
    for await (const chunk of request) {
      body += chunk
      if (Buffer.byteLength(body) > 2048) return fail(413)
    }
    let input
    try { input = JSON.parse(body) } catch { return fail(400) }
    const fields = ['grant_type', 'client_id', 'client_secret', 'audience', 'scope', 'source_binding']
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== fields.length || fields.some(key => typeof input[key] !== 'string')
      || input.grant_type !== 'client_credentials' || input.client_id !== 'collab.runtime'
      || input.audience !== 'data-runtime' || input.source_binding !== 'service-client-policy'
      || !['codocs:collaboration-snapshots:read', 'codocs:collaboration-snapshots:publish'].includes(input.scope)) return fail(403)
    let expected
    try {
      const profilePath = process.env.HZY0_PROFILE_PATH
      expected = collabTokenSecret || (profilePath?.startsWith('/') ? readCollabClientSecret(profilePath) : '')
    } catch { return fail(503) }
    if (!expected) return fail(503)
    const providedBytes = Buffer.from(input.client_secret)
    const expectedBytes = Buffer.from(expected)
    if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) return fail(401)
    try {
      const headers = await facade.headers(new Request(`https://${PUBLIC_HOST}/console/oauth/token`, { method: 'POST' }))
      headers.set('x-hzy-app-code', 'collab')
      headers.set('x-hzy-deployment', 'C000001-test-collab')
      headers.set('content-type', 'application/json')
      headers.delete('cookie')
      headers.delete('authorization')
      const upstream = await collabTokenFetch('http://127.0.0.1:23100/console/oauth/token', {
        method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(15_000)
      })
      if (!upstream.ok) return fail([400, 401, 403, 429, 503].includes(upstream.status) ? upstream.status : 503)
      const raw = await upstream.text()
      if (raw.length > 32_768) return fail(502)
      const token = JSON.parse(raw)
      if (typeof token.access_token !== 'string' || !token.access_token || token.token_type !== 'Bearer') return fail(502)
      response.writeHead(200, noStore)
      response.end(JSON.stringify({ access_token: token.access_token, token_type: token.token_type,
        expires_in: token.expires_in, scope: token.scope }))
    } catch { fail(503) }
  }

  async function proxyCodocsEditorShell(requestUrl, request, response) {
    if (!['GET', 'HEAD'].includes(request.method)) return reply(response, 405)
    // This path carries no document API calls or browser credentials. The
    // loopback-only Codocs worker supplies only the editor SPA and build assets.
    const target = new URL(requestUrl.pathname + requestUrl.search, `http://${codocsEditor.host}:${codocsEditor.port}`)
    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers: { accept: String(request.headers.accept || '*/*') },
        redirect: 'manual',
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
      })
      if (!upstream.ok) return replyUpstreamUnavailable(request, requestUrl, response, upstream.status)
      if (!upstream.body && request.method !== 'HEAD') return replyUpstreamUnavailable(request, requestUrl, response, 502)
      const headers = {
        'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      }
      response.writeHead(upstream.status, headers)
      if (request.method === 'HEAD') return response.end()
      Readable.fromWeb(upstream.body).pipe(response)
    } catch {
      if (!response.headersSent) replyUpstreamUnavailable(request, requestUrl, response)
      else response.destroy()
    }
  }

  async function proxyUpgrade(request, socket, head) {
    let requestUrl
    try {
      requestUrl = publicRequestUrl(request)
      if (request.method !== 'GET' || String(request.headers.upgrade || '').toLowerCase() !== 'websocket'
        || request.headers.origin !== `https://${PUBLIC_HOST}`) return socket.destroy()
      const route = resolveRoute(requestUrl)
      if (!route || route.kind === 'redirect') return socket.destroy()
      const headers = route.kind === 'collab'
        ? collabUpgradeHeaders(request)
        : Object.fromEntries(requestUrl.pathname.startsWith('/console/') && facade
          ? await facade.headers(new Request(requestUrl, { headers: sanitizedRequestHeaders(request.headers) }))
          : trustedHeaders(request, requestUrl))
      headers.connection = 'Upgrade'
      headers.upgrade = 'websocket'
      const upstream = httpRequest(upstreamOptions(request, requestUrl, route.path, headers, route.kind === 'collab' ? collab : enterprise))
      upstream.setTimeout(WS_HANDSHAKE_TIMEOUT_MS, () => upstream.destroy(new Error('websocket handshake timeout')))
      const abort = () => { try { upstream.destroy() } catch {} }
      socket.once('close', abort)
      socket.once('error', abort)
      upstream.once('error', () => socket.destroy())
      upstream.once('response', () => socket.destroy())
      upstream.once('upgrade', (upstreamResponse, peer, upstreamHead) => {
        upstream.setTimeout(0)
        const lines = rawHeaderPairs(upstreamResponse.rawHeaders)
          .filter(([name]) => !responseHeaderExcluded(name, connectionHeaderTokens(upstreamResponse.headers.connection)))
          .map(([name, value]) => `${name}: ${value}`)
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n${lines.join('\r\n')}\r\n\r\n`)
        if (head.length) peer.write(head)
        if (upstreamHead.length) socket.write(upstreamHead)
        socket.pipe(peer).pipe(socket)
        socket.setTimeout(WS_IDLE_TIMEOUT_MS, () => socket.destroy())
        peer.setTimeout(WS_IDLE_TIMEOUT_MS, () => peer.destroy())
        peer.once('error', () => socket.destroy())
        socket.once('close', () => peer.destroy())
        peer.once('close', () => socket.destroy())
      })
      upstream.end()
    } catch {
      socket.destroy()
    }
  }

  function trustedHeaders(request, requestUrl) {
    const incoming = sanitizedRequestHeaders(request.headers)
    const headers = buildForwardHeaders(new Request(requestUrl, { method: request.method, headers: incoming }), env, tenant, '/', 'enterprise')
    const dial = runtimeDialEndpoint(runtime)
    if (dial !== runtime.canonicalEndpoint) headers.set('x-hzy-local-runtime-dial-url', dial)
    headers.set('host', PUBLIC_HOST)
    headers.set('x-forwarded-host', PUBLIC_HOST)
    headers.set('x-forwarded-proto', 'https')
    headers.set('x-forwarded-port', '443')
    for (const name of HOP_BY_HOP) headers.delete(name)
    return headers
  }

  function upstreamOptions(request, requestUrl, pathname, headers, target = enterprise) {
    const forwardedHeaders = headers instanceof Headers ? Object.fromEntries(headers) : { ...headers }
    // Node does not infer chunked framing for DELETE. The ingress has already
    // parsed the client's framing; stream the validated bytes with new framing.
    if (request.method === 'DELETE') forwardedHeaders['transfer-encoding'] = 'chunked'
    return {
      hostname: target.host,
      port: target === enterprise && facade && pathname.startsWith('/console/') ? 23100 : target.port,
      method: request.method,
      path: `${pathname}${requestUrl.search}`,
      headers: forwardedHeaders
    }
  }

  function resolveRoute(requestUrl, method = 'GET') {
    if (requestUrl.pathname === '/codocs/ws') return profile.features?.codocsCollaborationV2 === true
      ? { path: '/codocs/ws', kind: 'collab' } : null
    if (requestUrl.pathname.startsWith('/console/')) return facade && consoleFacadeRoute(requestUrl.pathname, method)
      ? { path: requestUrl.pathname, kind: 'console' } : null
    if (INTERNAL_PATH.test(requestUrl.pathname)) return null
    if (requestUrl.pathname === '/enterprise') return { path: '/enterprise', kind: 'page' }
    if ((requestUrl.pathname === '/enterprise/approvals' || /^\/enterprise\/approvals\/[1-9]\d*$/.test(requestUrl.pathname)) && !['GET', 'HEAD'].includes(method)) return null
    // Exact Foundation directory endpoints needed by composed pages. Nitro
    // still authenticates and authorizes each request; no broad /api proxy.
    if (method === 'POST' && requestUrl.pathname === '/api/directory/users/batch') {
      return { path: requestUrl.pathname, kind: 'api' }
    }
    // The browser reaches only the exact Host BFF operations. Workflow itself
    // stays on loopback; there is no public /workflow service proxy here.
    if (profile.features?.workflowLocal === true && (
      (method === 'GET' && ['/api/workflow-proxy/instances/by-biz', '/api/workflow-proxy/instances/by-biz-history', '/api/workflow-proxy/tasks/pending'].includes(requestUrl.pathname))
      || (method === 'GET' && /^\/api\/workflow-proxy\/(?:instances|tasks)\/[1-9]\d*$/.test(requestUrl.pathname))
      || (method === 'POST' && /^\/api\/workflow-proxy\/tasks\/[1-9]\d*\/(?:approve|reject)$/.test(requestUrl.pathname))
    )) return { path: requestUrl.pathname, kind: 'api' }
    if ((method === 'GET' && ['/api/notifications', '/api/notifications/summary'].includes(requestUrl.pathname))
      || (method === 'POST' && requestUrl.pathname === '/api/notifications/read-all')
      || /^\/api\/notifications\/[A-Za-z0-9_-]{1,64}\/(?:detail|read|archive)$/.test(requestUrl.pathname)
        && ((method === 'GET' && requestUrl.pathname.endsWith('/detail'))
          || (method === 'POST' && (requestUrl.pathname.endsWith('/read') || requestUrl.pathname.endsWith('/archive'))))) {
      return { path: requestUrl.pathname, kind: 'api' }
    }
    // Do not open the entire root /api namespace or unrelated Console routes.
    if (method === 'GET' && (
      [
        '/api/directory/business-domains', '/api/directory/users', '/api/directory/projects', '/api/directory/me',
        '/api/directory/departments'
      ].includes(requestUrl.pathname)
      || /^\/api\/_nuxt_icon\/[a-z0-9-]+(?:\.json)?$/.test(requestUrl.pathname)
    )) return { path: requestUrl.pathname, kind: 'api' }
    if (requestUrl.pathname === '/__vite_ws' || requestUrl.pathname === '/__vite_ping') {
      return { path: requestUrl.pathname, kind: 'hmr' }
    }
    const route = resolveEnterprisePilotPath(requestUrl.pathname, requestUrl.search)
    return route?.kind === 'unavailable' ? null : route
  }

  function publicRequestUrl(request) {
    const host = String(request.headers.host || '').toLowerCase()
    const target = request.url || '/'
    if (host !== PUBLIC_HOST || target.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(target)) throw new Error('Unapproved request target')
    const url = new URL(target, `https://${PUBLIC_HOST}`)
    let decodedPath
    try { decodedPath = decodeURIComponent(url.pathname) } catch { throw new Error('Malformed request path') }
    if (INTERNAL_PATH.test(decodedPath)) throw INTERNAL_PATH_REJECTION
    return url
  }
}

function collabUpgradeHeaders(request) {
  // The one-time ticket travels in the first auth frame. A Collab socket must
  // never inherit the Gateway credential, browser cookies or caller headers.
  const headers = { origin: `https://${PUBLIC_HOST}` }
  for (const name of ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions']) {
    const value = request.headers[name]
    if (typeof value === 'string') headers[name] = value
  }
  return headers
}

function isCodocsEditorShellPath(pathname) {
  return /^\/codocs\/embed\/editor\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(pathname)
    || /^\/codocs\/(?:_nuxt|fonts|pdfjs)\//.test(pathname)
    || /^\/codocs\/api\/_nuxt_icon\/[a-z0-9-]+(?:\.json)?$/.test(pathname)
    || pathname === '/codocs/favicon.png'
}

function bindCancellation(request, response, upstream) {
  const abort = () => { try { upstream.destroy() } catch {} }
  request.once('aborted', abort)
  request.once('error', abort)
  response.once('close', abort)
}

function filteredResponseHeaders(response) {
  const connectionTokens = connectionHeaderTokens(response.headers.connection)
  const result = {}
  for (const [name, value] of rawHeaderPairs(response.rawHeaders)) {
    if (responseHeaderExcluded(name, connectionTokens)) continue
    const key = name.toLowerCase()
    if (key === 'set-cookie') (result[key] ||= []).push(value)
    else if (result[key]) result[key] = `${result[key]}, ${value}`
    else result[key] = value
  }
  return result
}

function responseHeaderExcluded(name, connectionTokens) {
  const key = name.toLowerCase()
  return HOP_BY_HOP.has(key) || connectionTokens.has(key) || key.startsWith('x-hzy-')
}

function connectionHeaderTokens(value) {
  return new Set(String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean))
}

function rawHeaderPairs(rawHeaders = []) {
  const pairs = []
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) pairs.push([rawHeaders[i], rawHeaders[i + 1]])
  return pairs
}

function sanitizedRequestHeaders(source) {
  const headers = new Headers(source)
  const connectionTokens = connectionHeaderTokens(headers.get('connection'))
  for (const name of HOP_BY_HOP) headers.delete(name)
  for (const name of connectionTokens) headers.delete(name)
  for (const name of ['forwarded', 'via', 'x-real-ip', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port']) headers.delete(name)
  return headers
}

function isLoopback(value) {
  const host = String(value || '').replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){0,3}$/.test(host)
}

function reply(response, status) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  response.end(status === 404 ? 'Not Found' : 'Local Enterprise gateway unavailable')
}

function replyUpstreamUnavailable(request, requestUrl, response, status = 503) {
  if (!wantsNavigationHtml(request.method, requestUrl.pathname, request.headers)) return reply(response, status)
  response.writeHead(status, { ...safeErrorHeaders(status, {}), 'content-type': 'text/html; charset=utf-8' })
  response.end(request.method === 'HEAD' ? undefined : navigationErrorHtml(status))
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}
