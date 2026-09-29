// Outbound transport for the Worker code running under Node.
//
// Every request the Worker makes (Service Binding or plain `fetch`) goes through
// `createEgressFetch`: only configured loopback app origins and the configured
// HTTPS Platform origin may be dialled; `*.invalid` origins (disabled routes)
// answer 404 locally; redirects are never followed to another origin.
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length']
const DECODED_ENCODINGS = new Set(['gzip', 'x-gzip', 'deflate', 'br', 'zstd'])
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

export class EgressRefusedError extends Error {
  constructor() {
    super('Gateway egress destination is not configured')
    this.name = 'EgressRefusedError'
  }
}

export function disabledResponse() {
  return new Response('Not Found', {
    status: 404,
    headers: { 'content-type': 'text/plain;charset=utf-8', 'cache-control': 'no-store' }
  })
}

/**
 * @param {object} options
 * @param {Map<string, 'loopback'|'platform'>} options.allowedOrigins
 * @param {typeof fetch} [options.baseFetch]
 * @param {number} [options.platformTimeoutMs]
 */
export function createEgressFetch({ allowedOrigins, baseFetch = globalThis.fetch, platformTimeoutMs = 15_000 }) {
  const allowed = new Map(allowedOrigins)
  for (const [origin, kind] of allowed) {
    if (kind === 'platform' && !origin.startsWith('https://')) throw new Error('Platform egress must use HTTPS')
  }
  return async function egressFetch(input, init = {}) {
    const merged = input instanceof Request
      ? { method: input.method, headers: input.headers, body: input.body, redirect: input.redirect, signal: input.signal, ...init }
      : { ...init }
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.hostname.endsWith('.invalid')) {
      await merged.body?.cancel?.().catch(() => {})
      return disabledResponse()
    }
    const kind = allowed.get(url.origin)
    if (!kind || url.username || url.password) throw new EgressRefusedError()

    const headers = new Headers(merged.headers)
    for (const name of connectionTokens(headers.get('connection'))) headers.delete(name)
    for (const name of HOP_BY_HOP) headers.delete(name)
    // Loopback bandwidth is free; ask apps not to compress so bodies stream
    // through unchanged (Node's fetch would otherwise transparently decode).
    if (kind === 'loopback') headers.set('accept-encoding', 'identity')

    const method = String(merged.method || 'GET').toUpperCase()
    const body = method === 'GET' || method === 'HEAD' ? undefined : merged.body ?? undefined
    let signal = merged.signal || undefined
    if (!signal && kind === 'platform') signal = AbortSignal.timeout(platformTimeoutMs)
    const response = await baseFetch(url, {
      method,
      headers,
      body,
      // Only an explicit manual redirect is passed through to the caller;
      // anything else refuses to follow, so no redirect leaves the allowlist.
      redirect: merged.redirect === 'manual' ? 'manual' : 'error',
      signal,
      ...(body && typeof body === 'object' && typeof body.getReader === 'function' ? { duplex: 'half' } : {})
    })
    return normalizeDecodedResponse(response)
  }
}

/**
 * Node's fetch decodes compressed bodies but keeps the original headers. Drop
 * the now-false content-encoding/content-length so the client is not told to
 * decode plain bytes.
 */
export function normalizeDecodedResponse(response) {
  const encodings = String(response.headers.get('content-encoding') || '')
    .split(',').map(item => item.trim().toLowerCase()).filter(Boolean)
  if (!encodings.length || !encodings.every(item => DECODED_ENCODINGS.has(item))) return response
  const headers = new Headers(response.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')
  return new Response(NULL_BODY_STATUSES.has(response.status) ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

/**
 * Cloudflare Service Binding semantics: the caller's URL host is irrelevant;
 * path and query are replayed against the one configured loopback origin.
 */
export function createServiceBinding(origin, egressFetch) {
  const target = new URL(origin)
  return Object.freeze({
    async fetch(input, init = {}) {
      const source = new URL(input instanceof Request ? input.url : String(input))
      const url = new URL(`${source.pathname}${source.search}`, target)
      if (input instanceof Request) {
        return await egressFetch(url, { method: input.method, headers: input.headers, body: input.body,
          redirect: input.redirect, signal: input.signal, ...init })
      }
      return await egressFetch(url, init)
    }
  })
}

export const disabledBinding = Object.freeze({
  async fetch(input, init = {}) {
    await (input instanceof Request ? input.body : init.body)?.cancel?.().catch(() => {})
    return disabledResponse()
  }
})

function connectionTokens(value) {
  return String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean)
}
