import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { safeError, safeErrorHeaders } from './error-contract.mjs'

export const CONSOLE_ORIGIN = 'https://hzy-test.huizhi.yun'
const readPaths = new Set([
  '/oauth/userinfo', '/.well-known/jwks.json', '/.well-known/openid-configuration',
  '/api/v1/console/runtime/apps/enterprise/config',
  '/api/v1/console/service/directory/users', '/api/v1/console/service/business-domains',
  '/api/v1/console/service/directory/project-access',
  '/api/v1/console/directory/users', '/api/v1/console/directory/projects', '/api/v1/console/directory/business-domains',
  '/api/v1/console/user/permissions', '/api/auth/permissions'
])
const postPaths = new Set(['/api/v1/console/user/scoped-authorization', '/api/v1/console/user/instance-conflict-explain'])

// Approved test product-edit exercise; Console's existing exact grant and
// Runtime actor/object permits remain authoritative. No other write scope.
function allowedServiceScope(scope, audience) {
  return typeof scope === 'string' && (
    /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*:(view|read)$/.test(scope)
    || (audience === 'data-runtime' && scope === 'assets:product:edit')
  )
}

export function allowedConsoleRequest(method, path, body) {
  if (method === 'GET') return readPaths.has(path)
  if (method !== 'POST') return false
  if (postPaths.has(path)) return true
  if (path !== '/oauth/token') return false
  let data
  try { data = JSON.parse(body) } catch { data = Object.fromEntries(new URLSearchParams(body)) }
  if (data.client_id === 'enterprise' && ['authorization_code', 'refresh_token'].includes(data.grant_type)) {
    const fields = data.grant_type === 'authorization_code'
      ? ['grant_type', 'client_id', 'code', 'redirect_uri', 'code_verifier']
      : ['grant_type', 'client_id', 'refresh_token']
    return Object.keys(data).every(key => fields.includes(key))
      && (data.grant_type !== 'authorization_code' || data.redirect_uri === 'https://hzy0.isme.dev/enterprise/api/auth/oidc-callback')
  }
  return data.grant_type === 'client_credentials' && data.client_id === 'enterprise.runtime'
    && data.app_code === 'enterprise' && ['data-runtime', 'console'].includes(data.audience)
    && ['trusted-gateway', 'service-client-policy'].includes(data.source_binding)
    && allowedServiceScope(data.scope, data.audience)
    && Object.keys(data).every(key => ['grant_type', 'client_id', 'app_code', 'audience', 'scope', 'source_binding'].includes(key))
}

export function createConsoleEgress({ localSecret, remoteSecret, fetchImpl = fetch }) {
  if (!localSecret || !remoteSecret || localSecret === remoteSecret) throw Error('Distinct egress credentials required')
  return createServer(async (req, res) => {
    const reply = status => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ statusCode: status, message: 'Console egress request failed' })) }
    const provided = Buffer.from(String(req.headers['x-hzy0-egress-token'] || ''))
    const expected = Buffer.from(localSecret)
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return reply(401)
    try {
      if (!req.url?.startsWith('/') || req.url.startsWith('//') || /%|\\/.test(req.url.split('?')[0])) return reply(403)
      const url = new URL(req.url, CONSOLE_ORIGIN)
      if (url.origin !== CONSOLE_ORIGIN || url.hash) return reply(403)
      let body = ''
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 65536) return reply(413) }
      if (!allowedConsoleRequest(req.method, url.pathname, body)) {
        console.error(JSON.stringify({ event: 'hzy0-console-egress', path: url.pathname, status: 403, stage: 'allowlist' }))
        return reply(403)
      }
      const headers = new Headers({ accept: 'application/json', 'content-type': req.headers['content-type'] === 'application/x-www-form-urlencoded' ? 'application/x-www-form-urlencoded' : 'application/json' })
      // Only user/session authorization passes through; all caller-supplied
      // routing, Gateway, Cloudflare and forwarding headers are discarded.
      for (const name of ['authorization', 'cookie']) if (req.headers[name]) headers.set(name, req.headers[name])
      for (const [name, value] of Object.entries({
        'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': remoteSecret,
        'x-hzy-app-code': 'enterprise', 'x-hzy-tenant': 'C000001',
        'x-hzy-environment': 'test', 'x-hzy-deployment': 'C000001-test-enterprise'
      })) headers.set(name, value)
      const controller = new AbortController()
      res.once('close', () => controller.abort())
      const response = await fetchImpl(url, { method: req.method, headers, redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        ...(req.method === 'POST' ? { body } : {}) })
      console.log(JSON.stringify({ event: 'hzy0-console-egress', path: url.pathname, status: response.status, stage: 'upstream' }))
      if (!response.ok) {
        let scope
        if (url.pathname === '/oauth/token') { try { const candidate = JSON.parse(body); if (allowedServiceScope(candidate.scope, candidate.audience)) scope = candidate.scope } catch {} }
        console.error(JSON.stringify({ event: 'hzy0-console-egress', path: url.pathname, status: response.status, scope }))
        let body = '', tooLarge = false
        if (response.body) for await (const chunk of response.body) {
          if (Buffer.byteLength(body) + chunk.length > 65536) { tooLarge = true; break }
          body += Buffer.from(chunk).toString()
        }
        res.writeHead(response.status, safeErrorHeaders(response.status, Object.fromEntries(response.headers)))
        res.end(JSON.stringify(safeError(response.status, response.headers.get('content-type'), tooLarge ? '' : body)))
        return
      }
      if (!response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); return reply(502) }
      const payload = await response.text()
      res.writeHead(response.status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(payload)
    } catch { if (!res.headersSent) reply(502); else res.destroy() }
  })
}
