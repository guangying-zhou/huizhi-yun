import { buildForwardHeaders, resolveRuntimeBootstrapToken } from '../../cloudflare/tenant-gateway/src/index.js'
import { allowedConsoleRequest } from './console-egress.mjs'
import { PINNED_RUNTIME_CANONICAL, PINNED_RUNTIME_DIAL } from './runtime-transport.mjs'
import { fileURLToPath } from 'node:url'

// Vite dev serves Nuxt's generated modules as percent-encoded absolute paths
// (/_nuxt/@id/virtual:nuxt:%2F...%2Fconsole%2F.nuxt%2Ffetch.mjs). Only those
// that decode to a plain file inside this checkout's console/.nuxt are admitted;
// every other encoded path stays rejected.
const CONSOLE_VIRTUAL_PREFIX = '/console/_nuxt/@id/virtual:nuxt:'
const CONSOLE_NUXT_DIR = fileURLToPath(new URL('../../../console/.nuxt/', import.meta.url))
export function consoleDevVirtualModule(path) {
  if (!path.startsWith(CONSOLE_VIRTUAL_PREFIX)) return false
  let id
  try { id = decodeURIComponent(path.slice(CONSOLE_VIRTUAL_PREFIX.length)) } catch { return false }
  if (!id.startsWith(CONSOLE_NUXT_DIR)) return false
  const rest = id.slice(CONSOLE_NUXT_DIR.length)
  return /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(rest) && !rest.split('/').some(part => part === '..' || part === '.')
}

const origin = 'https://hzy0.isme.dev'
export function allowedPublicFacadeToken(body) {
  let data
  try { data = JSON.parse(body) } catch { data = Object.fromEntries(new URLSearchParams(body)) }
  return ['authorization_code', 'refresh_token'].includes(data?.grant_type)
    && allowedConsoleRequest('POST', '/oauth/token', body)
}
export function consoleFacadeRoute(path, method) {
  if (['GET', 'HEAD'].includes(method) && consoleDevVirtualModule(path)) return true
  if (/%|\\/.test(path)) return false
  if (['GET', 'HEAD'].includes(method)) return [
    '/console/login', '/console/oauth/authorize', '/console/oauth/logout', '/console/oauth/userinfo',
    '/console/.well-known/openid-configuration', '/console/.well-known/jwks.json',
    '/console/api/auth/login-config', '/console/api/auth/oidc-login', '/console/api/auth/oidc-callback',
    '/console/api/auth/oidc-post-logout', '/console/api/auth/me', '/console/logo.svg', '/console/favicon.png',
    '/console/brand/hzy-logo.png'
  ].includes(path) || path.startsWith('/console/_nuxt/')
    || /^\/console\/api\/_nuxt_icon\/[a-z0-9-]+(?:\.json)?$/.test(path)
  return method === 'POST' && path === '/console/oauth/token'
}

// A bootstrap failure that means Platform is unreachable (transport error,
// timeout, 5xx, 408, 429). Refusals (other 4xx) and malformed responses are not.
export function bootstrapOutage(error) {
  const name = String(error?.name || '')
  const message = String(error?.message || '')
  const match = /^Platform runtime bootstrap token failed: (\d{3})$/.exec(message)
  if (match) {
    const status = Number(match[1])
    return status >= 500 || status === 408 || status === 429
  }
  return ['AbortError', 'TimeoutError'].includes(name) || error instanceof TypeError || error?.code === 'hzy0_simulated_platform_down'
}

export function createConsoleFacade({ localSecret, credentials, registryVars, tenant, runtimeDialEndpoint = PINNED_RUNTIME_CANONICAL, fetchImpl = fetch, fault = () => null, workflowLocal = false }) {
  if (!localSecret || !tenant || tenant.tenantCode !== 'C000001' || tenant.environment !== 'test'
    || tenant.apps?.console?.deploymentCode !== 'wiztek-test-console'
    || tenant.apps?.enterprise?.deploymentCode !== 'C000001-test-enterprise'
    || tenant.dataRuntime?.endpoint !== 'https://hzy-test-runtime.isme.dev'
    || tenant.login?.oidc?.issuer !== 'https://sso.wiztek.cn/realms/wiztek'
    || tenant.login?.oidc?.clientId !== 'hzy_local_console') throw Error('Local Console binding rejected')
  if (![PINNED_RUNTIME_CANONICAL, PINNED_RUNTIME_DIAL].includes(runtimeDialEndpoint)) throw Error('Local Runtime dial rejected')
  const upstreamFetch = (url, options) => fetchImpl(url, { ...options, redirect: 'error',
    signal: AbortSignal.timeout(15000) })
  return {
    async headers(request, { enterpriseSource = false } = {}) {
      const url = new URL(request.url)
      if (url.origin !== origin || !url.pathname.startsWith('/console/')) throw Error('Facade route rejected')
      // Never copy the remote Gateway credential into Console. Only this
      // process obtains the short-lived, fixed Console Runtime bootstrap.
      // Policy synchronization can spend most of a minute in Runtime. Its
      // bootstrap must be fresh *after* delivery, not merely unexpired now.
      const minValidityMs = url.pathname === '/console/api/internal/policy-bundle/sync' ? 75_000 : 45_000
      const bootstrapStartedAt = Date.now()
      let bootstrap
      let platformUnavailable = false
      try {
        // Acceptance switch: simulate Platform being down for the bootstrap too.
        if (fault() === 'platform-down') throw Object.assign(Error('simulated Platform outage'), { code: 'hzy0_simulated_platform_down' })
        bootstrap = await resolveRuntimeBootstrapToken({ ...registryVars, ...credentials }, tenant,
          upstreamFetch, minValidityMs, request.signal)
      } catch (error) {
        const name = String(error?.name || '')
        const match = /^Platform runtime bootstrap token failed: ([45]\d\d)$/.exec(String(error?.message || ''))
        const requestId = request.headers.get('x-request-id') || ''
        console.warn(JSON.stringify({ event: 'hzy0-console-bootstrap-failure', stage: 'platform-bootstrap',
          ...(requestId && /^[A-Za-z0-9_-]{1,64}$/.test(requestId) ? { requestId } : {}),
          ...(match ? { status: Number(match[1]) } : {}),
          errorClass: ['AbortError', 'TimeoutError'].includes(name) ? name : 'DependencyError',
          durationMs: Date.now() - bootstrapStartedAt }))
        // Platform unreachable: tell Console (over the trusted Gateway headers)
        // so it can use its steady service key. Runtime still decides whether
        // that key is currently authorized. Refusals keep failing closed.
        if (!bootstrapOutage(error)) throw error
        platformUnavailable = true
      }
      if (!platformUnavailable) {
        if (!bootstrap) throw Error('Console Runtime bootstrap unavailable')
        const claims = JSON.parse(Buffer.from(bootstrap.split('.')[1], 'base64url'))
        if (claims.iss !== 'https://hzy.wiztek.cn' || claims.aud !== 'data-runtime-bootstrap'
          || claims.tenant !== 'C000001' || claims.deployment !== 'wiztek-test-console'
          || claims.runtimeCode !== 'c000001-test-tenant-runtime' || claims.token_use !== 'platform_runtime_bootstrap'
          || claims.exp * 1000 <= Date.now() + minValidityMs) throw Error('Console bootstrap binding rejected')
      }
      // Runtime independently validates the signature; this is extra target pinning.
      const headers = buildForwardHeaders(request, { HZY_CLOUDFLARE_INTERNAL_TOKEN: localSecret }, tenant, '/console/', 'console')
      // Console is a protocol route rather than an APP_ROUTES business entry.
      // Publish its pinned owning deployment as well, so cross-app token
      // requests retain their caller identity without losing Console's binding.
      const catalog = JSON.parse(headers.get('x-hzy-service-routes') || '{}')
      headers.set('x-hzy-service-routes', JSON.stringify({ ...catalog, console: {
        origin: 'https://hzy-test.huizhi.yun', basePath: '/console/', deploymentCode: tenant.apps.console.deploymentCode
      } }))
      if (platformUnavailable) {
        headers.delete('x-hzy-data-runtime-token')
        headers.set('x-hzy-runtime-bootstrap-unavailable', 'platform')
      } else {
        headers.delete('x-hzy-runtime-bootstrap-unavailable')
        headers.set('x-hzy-data-runtime-token', bootstrap)
      }
      if (runtimeDialEndpoint === PINNED_RUNTIME_DIAL) headers.set('x-hzy-local-runtime-dial-url', runtimeDialEndpoint)
      headers.set('host', 'hzy0.isme.dev')
      if (enterpriseSource) {
        // Only the already authenticated/allowlisted private egress can request
        // this source identity; a browser request can never select it.
        headers.set('x-hzy-app-code', 'enterprise')
        headers.set('x-hzy-deployment', 'C000001-test-enterprise')
      }
      return headers
    },
    async fetch(input, init = {}) {
      const target = new URL(input)
      if (target.origin !== 'https://hzy-test.huizhi.yun' || target.username || target.password) throw Error('Console origin rejected')
      const url = new URL(`/console${target.pathname}${target.search}`, origin)
      const incoming = new Headers()
      const supplied = new Headers(init.headers)
      for (const name of ['accept', 'content-type', 'authorization', 'cookie', 'x-request-id']) {
        if (supplied.has(name)) incoming.set(name, supplied.get(name))
      }
      const headers = await this.headers(new Request(url, { method: init.method || 'GET', headers: incoming,
        ...(init.signal ? { signal: init.signal } : {}) }),
        { enterpriseSource: target.pathname === '/oauth/token'
          || (target.pathname === '/api/v1/console/notifications/publish' && init.method === 'POST') })
      if (workflowLocal && target.pathname === '/oauth/token' && init.method === 'POST') {
        let tokenRequest
        try { tokenRequest = JSON.parse(String(init.body || '')) } catch { tokenRequest = null }
        const sources = {
          'aims.runtime': { appCode: 'aims', deployment: 'C000001-test-aims' },
          'workflow.runtime': { appCode: 'workflow', deployment: 'C000001-test-workflow-local' }
        }
        const source = tokenRequest?.grant_type === 'client_credentials'
          && ['service-client-policy', 'trusted-gateway'].includes(tokenRequest?.source_binding)
          && tokenRequest?.client_id === `${tokenRequest?.app_code}.runtime`
          ? sources[tokenRequest.client_id] : null
        if (source) {
          headers.set('x-hzy-app-code', source.appCode)
          headers.set('x-hzy-deployment', source.deployment)
        }
      }
      return fetchImpl(`http://127.0.0.1:23100${url.pathname}${url.search}`, { ...init, headers, redirect: 'error' })
    }
  }
}
