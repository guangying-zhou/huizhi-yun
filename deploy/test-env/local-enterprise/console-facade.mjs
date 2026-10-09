import { hzy0ConsoleDirectorySyncReads, hzy0ConsoleDirectorySyncWrite, hzy0ConsoleDirectorySyncReadDetail, hzy0ConsoleFeedbackRoute } from '../enterprise-topology.mjs'
import { buildForwardHeaders, resolveRuntimeBootstrapToken } from '../../cloudflare/tenant-gateway/src/index.js'
import { allowedConsoleRequest } from './console-egress.mjs'
import { matchConsoleUserApiRoute } from '../../../foundation/shared/utils/consoleUserApiRoutes.ts'
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
// Managed gateways send root /api/* (not claimed by an app) to Console, so the
// Foundation avatar URL `/api/oss/avatar` is served by Console for the Host
// origin without a Host session (MODULE_CONTRACTS G-12). hzy0 mirrors only that
// exact GET/HEAD path onto the local Console base; Console still validates the
// avatar object path (avatars/ prefix, no traversal, image types only).
export function consoleAvatarFacadePath(path, method) {
  return ['GET', 'HEAD'].includes(method) && path === '/api/oss/avatar' ? '/console/api/oss/avatar' : null
}
export function consoleFacadeRoute(path, method) {
  if (['GET', 'HEAD'].includes(method) && consoleDevVirtualModule(path)) return true
  if (/%|\\/.test(path)) return false
  if (hzy0ConsoleFeedbackRoute(path, method)) return true
  if (['GET', 'HEAD'].includes(method)) return hzy0ConsoleDirectorySyncReadDetail(path) || [
    ...hzy0ConsoleDirectorySyncReads,
    '/console/login', '/console/oauth/authorize', '/console/oauth/logout', '/console/oauth/userinfo',
    '/console/.well-known/openid-configuration', '/console/.well-known/jwks.json',
    '/console/api/auth/login-config', '/console/api/auth/oidc-login', '/console/api/auth/oidc-callback',
    '/console/api/auth/oidc-post-logout', '/console/api/auth/me', '/console/logo.svg', '/console/favicon.png',
    '/console/brand/hzy-logo.png', '/console/api/oss/avatar'
  ].includes(path) || path.startsWith('/console/_nuxt/')
    || /^\/console\/api\/_nuxt_icon\/[a-z0-9-]+(?:\.json)?$/.test(path)
  return method === 'POST' && ['/console/oauth/token', hzy0ConsoleDirectorySyncWrite].includes(path)
}

// Public sync writes retain the Console session; this is an additional CSRF
// origin gate, never a source of actor identity. No other write API is opened.
export function allowedConsoleSyncOrigin(path, method, headers) {
  if (!(path === hzy0ConsoleDirectorySyncWrite && method === 'POST')
    && !(hzy0ConsoleFeedbackRoute(path, method) && !['GET', 'HEAD'].includes(method))) return true
  return headers.get('origin') === origin
    && !['cross-site', 'none'].includes(headers.get('sec-fetch-site') || '')
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

// Unverified claim read used only to pick which local source context the
// facade stamps on a service publish; Console still verifies the token.
function bearerSourceClaims(authorization) {
  const token = /^Bearer\s+([^.]+)\.([^.]+)\.[^.]+$/i.exec(String(authorization || ''))?.[2]
  if (!token) return null
  try {
    const claims = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))
    return claims && typeof claims === 'object' ? claims : null
  } catch { return null }
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
      // Console write routes require the caller's idempotency key: POST, plus
      // registered Console user write routes (PATCH/PUT/DELETE included).
      const idempotencyKey = supplied.get('idempotency-key') || ''
      const method = (init.method || 'GET').toUpperCase()
      const userWrite = matchConsoleUserApiRoute(method, target.pathname)?.write === true
      if ((method === 'POST' || userWrite) && /^[A-Za-z0-9:._-]{1,191}$/.test(idempotencyKey)) incoming.set('idempotency-key', idempotencyKey)
      const publish = target.pathname === '/api/v1/console/notifications/publish' && init.method === 'POST'
      const lifecycle = target.pathname === '/api/v1/console/notifications/actionable-lifecycle' && init.method === 'POST'
      const publisher = (publish || lifecycle) ? bearerSourceClaims(supplied.get('authorization')) : null
      // The Console derives its runtime binding from this forwarded context.
      // A local Workflow publish gets the Console's own context, exactly like
      // its actionable-lifecycle calls; the Console then selects the local
      // Workflow publisher binding. Every other publish stays Enterprise.
      const workflowPublish = workflowLocal && publisher?.source_app === 'workflow'
        && publisher?.deployment === 'C000001-test-workflow-local'
      const hostLifecycle = lifecycle && publisher?.source_app === 'enterprise'
        && publisher?.client_id === 'enterprise.runtime' && publisher?.deployment === 'C000001-test-enterprise'
      const headers = await this.headers(new Request(url, { method: init.method || 'GET', headers: incoming,
        ...(init.signal ? { signal: init.signal } : {}) }),
        { enterpriseSource: target.pathname === '/oauth/token' || (publish && !workflowPublish) || hostLifecycle })
      if (workflowLocal && target.pathname === '/oauth/token' && init.method === 'POST') {
        let tokenRequest
        try { tokenRequest = JSON.parse(String(init.body || '')) } catch { tokenRequest = null }
        const sources = {
          'aims.runtime': { appCode: 'aims', deployment: 'C000001-test-aims' },
          'workflow.runtime': { appCode: 'workflow', deployment: 'C000001-test-workflow-local' },
          ...(init.localCodocsSource === true ? { 'codocs.runtime': { appCode: 'codocs', deployment: 'C000001-test-codocs' } } : {})
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
