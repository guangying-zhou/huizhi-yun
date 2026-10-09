import { businessApiRoutes } from '../../enterprise/composition/business-api-routes.generated.mjs'
import { enterpriseHostEntries, enterpriseHostRoutes } from './enterprise-host-routes.mjs'

/** Explicit same-origin pilot; no DNS, credentials or deployment are created. */
export const enterprisePilot = Object.freeze({
  origin: 'https://hzy-test.huizhi.yun', tenantCode: 'C000001', environment: 'test',
  appCode: 'enterprise', deploymentCode: 'C000001-test-enterprise', workerName: 'hzy-test-enterprise',
  consoleDeployment: 'wiztek-test-console', consoleWorker: 'hzy-test-console',
  runtimeDeployment: 'c000001-test-tenant-runtime', runtimeEndpoint: 'https://hzy-test-runtime.isme.dev',
  authPrefix: '/enterprise', loginPath: '/enterprise/login',
  callback: 'https://hzy-test.huizhi.yun/enterprise/api/auth/oidc-callback',
  logoutRedirect: 'https://hzy-test.huizhi.yun/enterprise/login',
  buildAssetsDir: '/enterprise/_nuxt/', capabilitiesSource: './enterprise-readiness.template.json'
})
function matchesRegisteredPath(pathname, pattern) {
  const actual = pathname.split('/').filter(Boolean)
  const expected = pattern.split('/').filter(Boolean)
  if (actual.length !== expected.length) return false
  return expected.every((segment, index) => segment.startsWith(':') || segment === actual[index])
}

// Foundation user APIs the Host pages use, served by the Host under its own
// base because root /api/* belongs to Console (G-12). Exact METHOD + path only;
// every other method or path under the base stays unavailable.
export const enterpriseSharedApiBase = '/enterprise/api/foundation'
const sharedApiId = '[1-9]\\d{0,15}'
const sharedNotificationId = '[A-Za-z0-9_-]{1,64}'
const enterpriseSharedApiOperations = Object.freeze([
  ['GET', /^\/workflow-proxy\/instances\/by-biz(?:-history)?$/],
  ['GET', new RegExp(`^/workflow-proxy/(?:instances|tasks)/${sharedApiId}$`)],
  ['GET', /^\/workflow-proxy\/tasks\/pending$/],
  ['POST', new RegExp(`^/workflow-proxy/tasks/${sharedApiId}/(?:approve|reject)$`)],
  ['GET', /^\/notifications(?:\/summary)?$/],
  ['GET', new RegExp(`^/notifications/${sharedNotificationId}/detail$`)],
  ['POST', /^\/notifications\/read-all$/],
  ['POST', new RegExp(`^/notifications/${sharedNotificationId}/(?:read|archive)$`)],
  ['GET', /^\/user\/applications$/],
  ['GET', /^\/directory\/(?:me|users|departments|projects|business-domains)$/],
  ['POST', /^\/directory\/users\/batch$/]
])

function resolveEnterpriseSharedApiPath(path, method) {
  if (!path.startsWith(`${enterpriseSharedApiBase}/`)) return null
  const operation = path.slice(enterpriseSharedApiBase.length)
  return enterpriseSharedApiOperations.some(([allowed, pattern]) => allowed === method && pattern.test(operation))
    ? { path, kind: 'api' }
    : { path, kind: 'unavailable' }
}

function resolveLegacyShellPath(path, search = '') {
  const match = path.match(/^\/shell\/([a-z0-9-]+)\/?$/i)
  if (!match) return null
  const appCode = match[1].toLowerCase()
  if (!Object.hasOwn(enterpriseHostRoutes, appCode) || !enterpriseHostEntries[appCode]) return null
  const params = new URLSearchParams(search)
  const target = params.get('target') || enterpriseHostEntries[appCode]
  if (!target.startsWith(`/${appCode}/`) && target !== `/${appCode}`) return null
  let parsed
  try { parsed = new URL(target, enterprisePilot.origin) } catch { return null }
  if (parsed.origin !== enterprisePilot.origin || /\/(?:api|oauth|oidc)(?:\/|$)/i.test(parsed.pathname)) return null
  if ([`/${appCode}`, `/${appCode}/`].includes(parsed.pathname)) parsed.pathname = enterpriseHostEntries[appCode]
  if (!enterpriseHostRoutes[appCode].some(pattern => matchesRegisteredPath(parsed.pathname, pattern))) return null
  parsed.searchParams.delete('hzy_embed')
  parsed.searchParams.delete('standalone')
  return { path: `${parsed.pathname}${parsed.search}${parsed.hash}`, kind: 'redirect' }
}

export function resolveEnterprisePilotPath(path, search = '', method = 'GET') {
  const shell = resolveLegacyShellPath(path, search)
  if (shell) return shell
  // APF surfaces come from registered pages and actual BFF METHOD/path pairs.
  // No application-prefix wildcard or implicit HEAD/write permission.
  if (/^\/(?:finance|altoc|people)(?:\/|$)/.test(path)) {
    const app = path.split('/')[1]
    const safePath = !path.includes('//') && !path.endsWith('/') && /^\/[A-Za-z0-9._~/-]+$/.test(path) && !path.split('/').some(segment => segment === '.' || segment === '..')
    const match = pattern => safePath && matchesRegisteredPath(path, pattern)
      && (app !== 'altoc' || pattern.split('/').every((segment, index) => !segment.startsWith(':')
        || /^[1-9]\d{0,15}$/.test(path.split('/')[index]) && Number.isSafeInteger(Number(path.split('/')[index]))))
    if (path.startsWith(`/${app}/api/`)) {
      return { path, kind: businessApiRoutes.some(([allowed, pattern]) => allowed === method && pattern.startsWith(`/${app}/api/v1/`) && match(pattern)) ? 'api' : 'unavailable' }
    }
    return { path, kind: ['GET', 'HEAD'].includes(method) && (enterpriseHostRoutes[app] || []).some(match) ? 'page' : 'unavailable' }
  }
  // Host-owned APF APIs use the same generated METHOD/path registry as readiness.
  // Prefix membership alone grants nothing; unregistered paths and methods fail closed.
  if (path.startsWith('/enterprise/api/apf/')) {
    const safePath = !path.includes('//') && !path.endsWith('/')
      && /^\/[A-Za-z0-9._~/-]+$/.test(path)
      && !path.split('/').some(segment => segment === '.' || segment === '..')
    const registered = safePath && businessApiRoutes.some(([allowed, pattern]) => allowed === method
      && pattern.startsWith('/enterprise/api/apf/') && !pattern.includes('*')
      && matchesRegisteredPath(path, pattern))
    return { path, kind: registered ? 'api' : 'unavailable' }
  }
  // /enterprise is the Host workbench; the site root and the slash form are temporary aliases of it.
  if (path === '/enterprise') return { path, kind: 'page' }
  if (path === '/' || path === '/enterprise/') return { path: '/enterprise', kind: 'redirect' }
  if (path === '/enterprise/login') return { path, kind: 'page' }
  if (path === '/enterprise/approvals' || /^\/enterprise\/approvals\/[1-9]\d*$/.test(path)) return { path, kind: 'page' }
  if (path === '/enterprise/notifications' || /^\/enterprise\/notifications\/[A-Za-z0-9_-]{1,64}$/.test(path) || path === '/enterprise/todos') return { path, kind: 'page' }
  if (path === '/enterprise/help' || path === '/enterprise/announcements' || /^\/enterprise\/announcements\/[0-9a-f-]{36}$/.test(path)) return { path, kind: ['GET', 'HEAD'].includes(method) ? 'page' : 'unavailable' }
  if (/^\/enterprise\/api\/announcements(?:\/(?:manage|departments|surfaces|[0-9a-f-]{36}(?:\/(?:read|withdraw))?))?$/.test(path)) return { path, kind: businessApiRoutes.some(([allowed, pattern]) => allowed === method && matchesRegisteredPath(path, pattern)) ? 'api' : 'unavailable' }
  if (path === '/enterprise/profile') return { path, kind: 'page' }
  if (/^\/enterprise\/api\/feedback(?:\/(?:options|drafts|[A-Za-z0-9-]+(?:\/submit|\/attachments\/[a-f0-9-]{36})?))?$/.test(path)) return { path, kind: 'api' }
  if (path === '/enterprise/api/notifications/todos') return { path, kind: 'api' }
  const shared = resolveEnterpriseSharedApiPath(path, method)
  if (shared) return shared
  // Public Nuxt Icon JSON for the Host; no session is forwarded for assets.
  if (/^\/enterprise\/_nuxt_icon\/[a-z0-9-]+(?:\.json)?$/.test(path)) return ['GET', 'HEAD'].includes(method) ? { path, kind: 'asset' } : { path, kind: 'unavailable' }
  if (path === '/enterprise/logo.svg') return { path: '/logo.svg', kind: 'asset' }
  if (path === '/enterprise/illustrations/404.svg') return ['GET', 'HEAD'].includes(method) ? { path: '/illustrations/404.svg', kind: 'asset' } : { path, kind: 'unavailable' }
  if (path === '/enterprise/favicon.ico' || path === '/enterprise/favicon.png') return { path: path.slice('/enterprise'.length), kind: 'asset' }
  if (path === '/enterprise/api/org-brand') return method === 'GET' ? { path, kind: 'api' } : { path, kind: 'unavailable' }
  if (path === '/enterprise/api/navigation') return { path, kind: 'api' }
  // Per-module browser permission snapshot is a Host API, not a Foundation auth
  // route: it keeps its /enterprise path instead of the auth prefix rewrite.
  if (path === '/enterprise/api/auth/permissions') return method === 'GET' ? { path, kind: 'api' } : { path, kind: 'unavailable' }
  if (path.startsWith('/enterprise/api/auth/')) return { path: path.slice('/enterprise'.length), kind: 'auth' }
  if (path.startsWith('/enterprise/_nuxt/')) return { path, kind: 'asset' }
  if (/^\/(aims|assets|codocs)(\/|$)/.test(path)) return { path, kind: path.includes('/api/') ? 'api' : 'page' }
  // Any other Host page path renders the Host's own 404 page (an SPA shell: no session is
  // forwarded for pages). Only reads of plain paths; APIs and writes stay unavailable.
  if (['GET', 'HEAD'].includes(method) && /^\/enterprise\/[A-Za-z0-9._~/-]{1,256}$/.test(path)
    && !path.startsWith('/enterprise/api/') && !path.split('/').some(segment => segment === '.' || segment === '..')) return { path, kind: 'page' }
  if (path.startsWith('/enterprise/')) return { path, kind: 'unavailable' }
  return null
}
const allowlistHost = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const allowlistIdentifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/**
 * Parse the explicit Enterprise Host allowlist supplied by gateway configuration
 * (`HZY_ENTERPRISE_HOST_ALLOWLIST_JSON`). Each entry pins one public host to one
 * tenant + environment + Enterprise deployment code. Absent means no entries;
 * any malformed value returns null so callers fail closed.
 */
export function parseEnterpriseHostAllowlist(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return []
  let value
  try { value = JSON.parse(text) } catch { return null }
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) return null
  const entries = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).sort().join() !== 'deploymentCode,environment,host,tenantCode') return null
    if (typeof item.host !== 'string' || !allowlistHost.test(item.host)
      || ![item.tenantCode, item.environment, item.deploymentCode].every(field => typeof field === 'string' && allowlistIdentifier.test(field))) return null
    entries.push(Object.freeze({ host: item.host, tenantCode: item.tenantCode, environment: item.environment, deploymentCode: item.deploymentCode }))
  }
  return entries
}

/** Allowlist entries for one request host; malformed configuration yields none. */
export function enterpriseHostAllowlistFor(raw, host) {
  const entries = parseEnterpriseHostAllowlist(raw)
  const normalized = String(host || '').trim().toLowerCase()
  return entries ? entries.filter(entry => entry.host === normalized) : []
}

/**
 * The pinned test pilot is always accepted exactly as before. Any other tenant is
 * accepted only when an explicit allowlist entry (already filtered to the request
 * host) matches tenant, environment and Enterprise deployment code exactly.
 */
export function validateEnterprisePilotBinding(tenant, binding, allowlist = []) {
  if (typeof binding?.fetch !== 'function') return false
  const deploymentCode = tenant?.apps?.enterprise?.deploymentCode
  if (tenant?.tenantCode === enterprisePilot.tenantCode && tenant?.environment === 'test'
    && deploymentCode === enterprisePilot.deploymentCode) return true
  return Array.isArray(allowlist) && typeof deploymentCode === 'string' && allowlist.some(entry =>
    entry?.tenantCode === tenant?.tenantCode && entry?.environment === tenant?.environment
    && entry?.deploymentCode === deploymentCode)
}

// hzy0-only standalone Console administration entry. This registers transport,
// not permission: Console sessions and directory_sync edit+admin remain required.
export const hzy0ConsoleDirectorySyncReads = Object.freeze([
  '/console/admin', '/console/directory/sync',
  '/console/api/v1/console/auth/me', '/console/api/auth/permissions',
  '/console/api/activation/status',
  '/console/api/v1/console/authorization/simulation-sessions/current',
  '/console/api/v1/console/directory/sync-jobs'
])
export const hzy0ConsoleDirectorySyncWrite = '/console/api/v1/console/directory/sync-jobs'

export function hzy0ConsoleDirectorySyncReadDetail(path) {
  const code = '[A-Za-z0-9_-]{1,191}'
  return new RegExp(`^/console/directory/sync/${code}$`).test(path)
    || new RegExp(`^/console/api/v1/console/directory/sync-jobs/${code}(?:/events)?$`).test(path)
}

// G0/G1 standalone administrator transport; authorization remains in Console.
export function hzy0ConsoleFeedbackRoute(path, method) {
  if (['GET', 'HEAD'].includes(method)) return ['/console/admin/feedback', '/console/api/v1/console/feedback', '/console/api/v1/console/feedback-settings'].includes(path)
    || /^\/console\/api\/v1\/console\/feedback\/[A-Za-z0-9_-]{1,64}$/.test(path)
  if (method === 'PATCH') return path === '/console/api/v1/console/feedback-settings'
  return method === 'POST' && /^\/console\/api\/v1\/console\/feedback\/[A-Za-z0-9_-]{1,64}\/(?:retry|cancel)$/.test(path)
}
