export const CONSOLE_ROOT_ROUTE_PREFIXES = [
  '/directory',
  '/org-profile',
  '/system-settings',
  '/work-calendar',
  '/integrations',
  '/data-runtime',
  '/notifications',
  '/notification-runtime',
  '/connector-runtime',
  '/vault',
  '/service-clients'
]

export function isConsoleRootRoute(pathname: string) {
  return CONSOLE_ROOT_ROUTE_PREFIXES.some(prefix => (
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  ))
}

export interface NotificationActionTarget {
  actionUrl?: string | null
  actionTargetAppCode?: string | null
  sourceAppCode?: string | null
}

export interface NotificationTargetApplication {
  appCode: string
  homeUrl?: string | null
  basePath?: string | null
  status?: string | null
  deploymentState?: 'deployed' | 'not-deployed'
}

export interface NotificationActionTargetCatalog {
  applications: NotificationTargetApplication[]
  currentOrigin: string
  source: 'policy_bundle' | 'local_dev'
}

function normalizedBasePath(value: string) {
  const base = value.replace(/\/+$/, '') || '/'
  return base === '/' ? '/' : `${base}/`
}

function pathWithinBase(pathname: string, basePath: string) {
  const baseWithoutSlash = basePath.replace(/\/$/, '') || '/'
  return baseWithoutSlash === '/'
    || pathname === baseWithoutSlash
    || pathname.startsWith(basePath)
}

function unsafeEncodedPath(value: string) {
  if (/%(?:2f|5c)/i.test(value)) return true
  let decoded = value
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      return true
    }
  }
  return decoded.split('/').some(segment => segment === '.' || segment === '..')
    || /[\r\n\\]/.test(decoded)
}

function safeHttpUrl(value: string, origin: string) {
  const hasControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  if (!value || value.startsWith('//') || hasControlCharacter || value.includes('\\') || unsafeEncodedPath(value)) return null
  try {
    const url = new URL(value, origin)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    return url
  } catch {
    return null
  }
}

function applicationHome(
  application: NotificationTargetApplication,
  currentOrigin: string
) {
  const home = safeHttpUrl(String(application.homeUrl || '').trim(), currentOrigin)
  if (!home) return null
  // Platform has already resolved the environment-specific public URL and
  // base path into homeUrl. Treat that pathname as authoritative: a default
  // independent-domain homeUrl may legitimately be '/' while the deployment
  // basePath field still carries the shared-site default (for example /aims/).
  const basePath = normalizedBasePath(home.pathname || String(application.basePath || '').trim())
  const configuredInputBasePath = String(application.basePath || '').trim().startsWith('/')
    ? normalizedBasePath(String(application.basePath).trim())
    : null
  home.pathname = basePath
  home.search = ''
  home.hash = ''
  return {
    home,
    basePath,
    inputBasePaths: [...new Set([basePath, configuredInputBasePath].filter((path): path is string => Boolean(path) && path !== '/'))]
      .sort((left, right) => right.length - left.length)
  }
}

/**
 * The Enterprise Host's own pages live under this site path on whatever origin
 * serves the Host. Only the Host itself passes this context (see
 * `hostNotificationTarget()` in the app utils); servers never do.
 */
export const ENTERPRISE_HOST_NOTIFICATION_TARGET = Object.freeze({
  appCode: 'enterprise',
  basePath: '/enterprise/'
} as const)

export type NotificationHostTarget = typeof ENTERPRISE_HOST_NOTIFICATION_TARGET

// Host API, asset and framework paths are never navigation targets.
const HOST_RESERVED_SEGMENT = /^(?:api|_nuxt|_nuxt_icon|_nitro|_hzy0_worker_health|__.*)$/i

/**
 * Resolves a notification whose explicit action target is the Enterprise Host
 * while the viewer is inside that Host. The Host's pages are native entries,
 * not catalog applications, and the stored absolute URL carries the origin of
 * the signed deployment catalog, which a mirrored site (for example the local
 * hzy0 stack) does not share. The result is therefore a site-relative path:
 * only the path/query/hash of a safe http(s) or single-slash value is kept, it
 * must stay inside the Host base path, and navigation stays on the current
 * origin, so no external or open redirect is possible.
 */
function resolveHostNativeActionUrl(actionValue: string, currentOrigin: string, host: NotificationHostTarget) {
  const action = safeHttpUrl(actionValue, currentOrigin)
  if (!action || action.pathname.includes('//') || !pathWithinBase(action.pathname, host.basePath)) return ''
  const relative = action.pathname.slice(host.basePath.length)
  const firstSegment = relative.split('/')[0] || ''
  // Host route names are literal. Reject encoded first segments rather than
  // letting the browser/router decode a reserved API or framework route later.
  if (firstSegment.includes('%') || HOST_RESERVED_SEGMENT.test(firstSegment)) return ''
  return `${action.pathname}${action.search}${action.hash}`
}

export function resolveNotificationActionUrl(
  detail: NotificationActionTarget,
  applications: NotificationTargetApplication[],
  currentOrigin: string,
  host?: NotificationHostTarget | null
) {
  const actionValue = String(detail.actionUrl || '').trim()
  const targetAppCode = String(detail.actionTargetAppCode || detail.sourceAppCode || '').trim().toLowerCase()
  if (!actionValue || !targetAppCode || (!actionValue.startsWith('/') && !/^https?:\/\//i.test(actionValue))) return ''

  // Only the Host's own target is Host-native; every other target (and the
  // Host target viewed outside the Host) keeps the catalog rules below.
  if (host && host === ENTERPRISE_HOST_NOTIFICATION_TARGET && targetAppCode === host.appCode) {
    return resolveHostNativeActionUrl(actionValue, currentOrigin, host)
  }

  const application = applications.find(app => (
    String(app.appCode || '').trim().toLowerCase() === targetAppCode
    && (!String(app.status || '').trim() || String(app.status).trim().toLowerCase() === 'active')
  ))
  if (!application) return ''

  const approved = applicationHome(application, currentOrigin)
  const action = safeHttpUrl(actionValue, currentOrigin)
  if (!approved || !action) return ''

  if (/^https?:\/\//i.test(actionValue)) {
    return action.origin === approved.home.origin && pathWithinBase(action.pathname, approved.basePath)
      ? action.toString()
      : ''
  }

  if (
    targetAppCode === 'console'
    && normalizedBasePath(String(application.basePath || '').trim()) === '/'
    && isConsoleRootRoute(action.pathname)
  ) {
    approved.home.pathname = action.pathname
    approved.home.search = action.search
    approved.home.hash = action.hash
    return approved.home.toString()
  }

  // Producers may publish an app-relative path (/invoices/1) or a path that
  // already includes the deployment base (/finance/invoices/1).
  const inputBasePath = approved.inputBasePaths.find(basePath => pathWithinBase(action.pathname, basePath))
  const relativePath = inputBasePath
    ? action.pathname.slice(inputBasePath.replace(/\/$/, '').length).replace(/^\/+/, '')
    : action.pathname.replace(/^\/+/, '')
  approved.home.pathname = `${approved.basePath}${relativePath}`.replace(/\/{2,}/g, '/')
  approved.home.search = action.search
  approved.home.hash = action.hash
  return approved.home.toString()
}
