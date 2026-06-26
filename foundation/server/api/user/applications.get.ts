import { createError, getCookie, getHeader, getRequestURL, type H3Event } from 'h3'
import { buildAppHomeUrl, getConfiguredAppBasePath, resolveCurrentAppHomeUrl } from '../../utils/appUrls'
import {
  getConsoleRuntimeConfig,
  resolveConsoleRuntimeBaseUrl,
  resolveConsoleRuntimeSeedConfig,
  type ConsoleRuntimeApp,
  type ConsoleRuntimeConfig
} from '../../utils/consoleRuntime'
import {
  isActiveHzyDevApplication,
  resolveHzyDevApplications
} from '../../utils/devApplications'
import { loadHzyLocalDevRuntimeMode } from '../../utils/localDevRuntime'

interface ConsoleAuthContext {
  authenticated?: boolean
  uid?: string
  token?: string
  tokenUse?: string
  subjectType?: string
}

interface AppItem {
  appCode: string
  appName: string
  description: string | null
  icon: string | null
  homeUrl: string | null
  basePath?: string | null
  apiBase?: string | null
  sortOrder?: number | null
  appType: string
  serviceRole?: string | null
  status?: string | null
}

type BundleRecord = Record<string, unknown>

interface ConsoleUserApplicationsEnvelope {
  code?: number
  data?: unknown
  message?: string
}

interface ConsoleUserApplicationsResult {
  apps: AppItem[]
  authoritative: boolean
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function nullableString(value: unknown) {
  const normalized = stringValue(value)
  return normalized || null
}

function records(value: unknown): BundleRecord[] {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as BundleRecord[]
    : []
}

function isActive(record: BundleRecord | AppItem) {
  const status = stringValue(record.status)
  return !status || status === 'active'
}

function runtimePublicConfig(event: H3Event) {
  return (useRuntimeConfig(event).public || {}) as Record<string, unknown>
}

function getRequestProtocol(event: H3Event) {
  const forwardedProto = stringValue(getHeader(event, 'x-forwarded-proto')).split(',')[0]?.trim()
  if (forwardedProto) {
    return forwardedProto.replace(/:$/, '')
  }

  return getRequestURL(event).protocol.replace(/:$/, '') || 'http'
}

function getRequestHost(event: H3Event) {
  return stringValue(getHeader(event, 'x-forwarded-host')).split(',')[0]?.trim()
    || getRequestURL(event).host
}

function getRequestPublicOrigin(event: H3Event) {
  return `${getRequestProtocol(event)}://${getRequestHost(event)}`
}

function normalizeNavigableUrl(event: H3Event, value: unknown) {
  const normalized = nullableString(value)
  if (!normalized) return null
  const hostLike = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?:[/?#].*)?$/i

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) {
    return normalized
  }

  if (normalized.startsWith('//')) {
    return `${getRequestProtocol(event)}:${normalized}`
  }

  const withoutLeadingSlash = normalized.replace(/^\/+/, '')
  if (normalized.startsWith('/') && hostLike.test(withoutLeadingSlash)) {
    return `${getRequestProtocol(event)}://${withoutLeadingSlash}`
  }

  if (normalized.startsWith('/')) {
    return normalized
  }

  if (hostLike.test(normalized)) {
    return `${getRequestProtocol(event)}://${normalized}`
  }

  return `/${normalized.replace(/^\/+/, '')}`
}

function getRequestUid(event: H3Event) {
  const consoleAuth = event.context.consoleAuth as ConsoleAuthContext | undefined
  const verifiedUid = stringValue(consoleAuth?.uid)
  if (consoleAuth?.authenticated && verifiedUid) {
    return verifiedUid
  }

  return stringValue(getCookie(event, 'auth_user'))
}

function currentApplication(event: H3Event): AppItem {
  const pub = runtimePublicConfig(event)
  const appCode = stringValue(pub.appCode) || stringValue(pub.appName) || 'app'

  return {
    appCode,
    appName: stringValue(pub.appDisplayName) || stringValue(pub.appName) || appCode,
    description: null,
    icon: nullableString(pub.appIcon),
    homeUrl: resolveCurrentAppHomeUrl(event),
    basePath: getConfiguredAppBasePath(event),
    sortOrder: Number.MAX_SAFE_INTEGER - 1,
    appType: 'business',
    status: 'active'
  }
}

function appendNavigablePath(event: H3Event, baseUrl: unknown, path: string) {
  const root = normalizeNavigableUrl(event, baseUrl)
  if (!root) return null

  const suffix = `/${path.replace(/^\/+/, '')}`
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(root)) {
    try {
      const url = new URL(root)
      const basePath = url.pathname.replace(/\/+$/, '')
      url.pathname = `${basePath}${suffix}` || suffix
      url.search = ''
      url.hash = ''
      return url.toString()
    } catch {
      return `${root.replace(/[?#].*$/, '').replace(/\/+$/, '')}${suffix}`
    }
  }

  return `${root.replace(/[?#].*$/, '').replace(/\/+$/, '')}${suffix}`
}

function normalizeConsoleWorkspaceUrl(event: H3Event, value: unknown) {
  const root = normalizeNavigableUrl(event, value)
  if (!root) return null

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(root)) {
    try {
      const url = new URL(root)
      url.pathname = url.pathname.replace(/\/admin\/?$/i, '/') || '/'
      url.search = ''
      url.hash = ''
      return url.toString()
    } catch {
      return root.replace(/[?#].*$/, '').replace(/\/admin\/?$/i, '/') || '/'
    }
  }

  return root.replace(/[?#].*$/, '').replace(/\/admin\/?$/i, '/') || '/'
}

function configuredDeploymentPublicUrl(event: H3Event) {
  const pub = runtimePublicConfig(event)
  return nullableString(getRequestPublicOrigin(event))
    || nullableString(process.env.HZY_DEPLOYMENT_PUBLIC_URL)
    || nullableString(pub.deploymentPublicUrl)
}

function consolePortalApplications(event: H3Event): AppItem[] {
  const pub = runtimePublicConfig(event)
  const homeUrl = configuredDeploymentPublicUrl(event)
    || nullableString(process.env.HZY_CONSOLE_URL)
    || nullableString(process.env.HZY_CONSOLE_API_URL)
    || nullableString(pub.consoleUrl)
    || nullableString(resolveConsoleRuntimeBaseUrl(useRuntimeConfig(event) as unknown as Record<string, unknown>))

  if (!homeUrl) {
    return []
  }

  const workspaceUrl = normalizeConsoleWorkspaceUrl(event, homeUrl)

  return [
    {
      appCode: 'workspace',
      appName: '工作台',
      description: '企业统一入口',
      icon: 'i-lucide-house',
      homeUrl: workspaceUrl,
      basePath: null,
      sortOrder: -2000,
      appType: 'base_runtime',
      serviceRole: 'supporting_service',
      status: 'active'
    },
    {
      appCode: 'console',
      appName: '控制台',
      description: '企业控制台',
      icon: 'i-lucide-monitor-cog',
      homeUrl: appendNavigablePath(event, workspaceUrl, '/admin'),
      basePath: null,
      sortOrder: -1000,
      appType: 'base_runtime',
      serviceRole: 'supporting_service',
      status: 'active'
    }
  ]
}

function normalizeAppItem(event: H3Event, value: unknown, deploymentPublicUrl?: string | null): AppItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as BundleRecord
  const appCode = stringValue(record.appCode)
  if (!appCode) return null

  const basePath = nullableString(record.basePath)
  const apiBase = nullableString(record.apiBase)
  const homeUrl = buildAppHomeUrl(deploymentPublicUrl, basePath)
    || nullableString(record.homeUrl)
    || buildAppHomeUrl(configuredDeploymentPublicUrl(event), basePath)

  return {
    appCode,
    appName: stringValue(record.appName) || appCode,
    description: nullableString(record.description),
    icon: nullableString(record.icon),
    homeUrl: normalizeNavigableUrl(event, homeUrl),
    basePath,
    apiBase,
    sortOrder: Number.isFinite(Number(record.sortOrder)) ? Number(record.sortOrder) : null,
    appType: stringValue(record.appType) || 'business',
    serviceRole: nullableString(record.serviceRole),
    status: nullableString(record.status)
  }
}

function appsFromConsoleRuntime(event: H3Event, applications: ConsoleRuntimeApp[] = []) {
  return applications
    .map(item => normalizeAppItem(event, item))
    .filter((item): item is AppItem => Boolean(item))
    .filter(isActive)
}

function appsFromLocalDevCatalog(event: H3Event) {
  return resolveHzyDevApplications({ logPrefix: '[Applications]' })
    .filter(isActiveHzyDevApplication)
    .map(item => normalizeAppItem(event, item))
    .filter((item): item is AppItem => Boolean(item))
    .filter(isActive)
}

function extractAppItems(event: H3Event, value: unknown) {
  const items = Array.isArray(value)
    ? value
    : records((value as Record<string, unknown> | undefined)?.items)

  return items
    .map(item => normalizeAppItem(event, item))
    .filter((item): item is AppItem => Boolean(item))
    .filter(isActive)
}

function resolveConsoleUserApplicationsUrl(event: H3Event, runtime: ConsoleRuntimeConfig | null) {
  const serverBaseUrl = resolveConsoleServerBaseUrl(event)
  if (serverBaseUrl && /^[a-z][a-z0-9+.-]*:\/\//i.test(serverBaseUrl)) {
    return appendNavigablePath(event, serverBaseUrl, '/api/user/applications')
  }

  const direct = normalizeNavigableUrl(event, runtime?.console?.userApplicationsUrl)
  if (direct && /^[a-z][a-z0-9+.-]*:\/\//i.test(direct)) {
    return direct
  }

  const baseUrl = normalizeNavigableUrl(event, runtime?.console?.baseUrl)
    || normalizeNavigableUrl(event, resolveConsoleRuntimeBaseUrl(useRuntimeConfig(event) as unknown as Record<string, unknown>))
  if (!baseUrl || !/^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl)) {
    return null
  }

  return appendNavigablePath(event, baseUrl, '/api/user/applications')
}

function resolveConsoleBearerUserApplicationsUrl(event: H3Event, runtime: ConsoleRuntimeConfig | null) {
  const baseUrl = resolveConsoleServerBaseUrl(event)
    || normalizeNavigableUrl(event, runtime?.console?.baseUrl)
    || normalizeNavigableUrl(event, resolveConsoleRuntimeBaseUrl(useRuntimeConfig(event) as unknown as Record<string, unknown>))
  if (!baseUrl || !/^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl)) {
    return null
  }

  return appendNavigablePath(event, baseUrl, '/api/v1/console/user/applications')
}

function resolveConsoleServerBaseUrl(event: H3Event) {
  const config = useRuntimeConfig(event) as unknown as {
    hzy?: Record<string, unknown>
    public?: Record<string, unknown>
  }
  return normalizeNavigableUrl(event, resolveConsoleRuntimeSeedConfig(config, event).consoleApiUrl)
}

function authForwardHeaders(event: H3Event) {
  const headers: Record<string, string> = {}
  const cookie = stringValue(getHeader(event, 'cookie'))
  const authorization = stringValue(getHeader(event, 'authorization'))
  const consoleAuth = event.context.consoleAuth as ConsoleAuthContext | undefined
  const contextToken = stringValue(consoleAuth?.token)
  const forwardedProto = stringValue(getHeader(event, 'x-forwarded-proto')) || getRequestProtocol(event)
  const forwardedHost = stringValue(getHeader(event, 'x-forwarded-host') || getHeader(event, 'host')) || getRequestHost(event)
  if (cookie) headers.cookie = cookie
  if (authorization) {
    headers.authorization = authorization
  } else if (
    consoleAuth?.authenticated
    && contextToken
    && consoleAuth.tokenUse !== 'legacy_session'
    && consoleAuth.subjectType !== 'service'
  ) {
    headers.authorization = `Bearer ${contextToken}`
  }
  for (const name of [
    'x-hzy-gateway',
    'x-hzy-gateway-token',
    'x-hzy-tenant',
    'x-hzy-deployment',
    'x-hzy-environment',
    'x-forwarded-port',
    'x-forwarded-prefix'
  ]) {
    const value = stringValue(getHeader(event, name))
    if (value) headers[name] = value
  }
  if (forwardedProto) {
    headers['x-forwarded-proto'] = forwardedProto
  }
  if (forwardedHost) {
    headers['x-forwarded-host'] = forwardedHost
  }

  return headers
}

function hasConsoleUserApplicationsAuthorization(event: H3Event) {
  const consoleAuth = event.context.consoleAuth as ConsoleAuthContext | undefined
  return Boolean(
    stringValue(getHeader(event, 'authorization'))
    || (
      consoleAuth?.authenticated
      && stringValue(consoleAuth.token)
      && consoleAuth.tokenUse !== 'legacy_session'
      && consoleAuth.subjectType !== 'service'
    )
  )
}

async function fetchConsoleUserApplications(
  event: H3Event,
  runtime: ConsoleRuntimeConfig | null
): Promise<ConsoleUserApplicationsResult> {
  const hasAuthorization = hasConsoleUserApplicationsAuthorization(event)
  const url = hasAuthorization
    ? resolveConsoleBearerUserApplicationsUrl(event, runtime) || resolveConsoleUserApplicationsUrl(event, runtime)
    : resolveConsoleUserApplicationsUrl(event, runtime)
  if (!url) return { apps: [], authoritative: false }

  const headers = authForwardHeaders(event)
  if (!headers.cookie && !headers.authorization) {
    return { apps: [], authoritative: false }
  }

  const response = await $fetch<ConsoleUserApplicationsEnvelope>(url, {
    headers,
    timeout: 3000
  })

  if (response.code !== undefined && response.code !== 0) {
    throw new Error(response.message || 'Console user applications response is invalid')
  }

  return {
    apps: extractAppItems(event, response.data),
    authoritative: hasAuthorization
  }
}

function mergeApplication(apps: AppItem[], fallback: AppItem | null, options: { preferFallbackHomeUrl?: boolean, preferFallbackIcon?: boolean } = {}) {
  if (!fallback) return apps
  const existing = apps.find(app => app.appCode === fallback.appCode)
  if (!existing) {
    return [fallback, ...apps]
  }

  return apps.map(app => app.appCode === fallback.appCode
    ? {
        ...app,
        appName: app.appName || fallback.appName,
        icon: options.preferFallbackIcon ? fallback.icon || app.icon : app.icon || fallback.icon,
        homeUrl: options.preferFallbackHomeUrl ? fallback.homeUrl || app.homeUrl : app.homeUrl || fallback.homeUrl,
        basePath: app.basePath || fallback.basePath,
        apiBase: app.apiBase || fallback.apiBase,
        sortOrder: app.sortOrder ?? fallback.sortOrder,
        appType: app.appType || fallback.appType,
        serviceRole: app.serviceRole || fallback.serviceRole
      }
    : app)
}

function mergeApplications(apps: AppItem[], fallbacks: AppItem[], options: { preferFallbackHomeUrl?: boolean, preferFallbackIcon?: boolean } = {}) {
  return fallbacks.reduce((merged, fallback) => mergeApplication(merged, fallback, options), apps)
}

function portalApplicationsForAuthorization(consoleApps: AppItem[], canAccessConsole: boolean) {
  return consoleApps.filter(app => app.appCode !== 'console' || canAccessConsole)
}

function appSortOrder(app: AppItem) {
  const value = Number(app.sortOrder)
  if (Number.isFinite(value)) return value
  if (app.appCode === 'workspace') return -2000
  if (app.appCode === 'console') return -1000
  return Number.MAX_SAFE_INTEGER
}

function sortApplications(apps: AppItem[]) {
  return [...apps].sort((a, b) => appSortOrder(a) - appSortOrder(b) || a.appCode.localeCompare(b.appCode))
}

function isPortalAppCode(appCode: string) {
  return appCode === 'workspace' || appCode === 'console'
}

function businessApplications(apps: AppItem[]) {
  return apps.filter(app => !isPortalAppCode(app.appCode))
}

function shouldUseConsoleUserApplications(
  result: ConsoleUserApplicationsResult,
  runtimeApps: AppItem[]
) {
  if (!result.apps.length) return false

  const resultBusinessAppCount = businessApplications(result.apps).length
  if (result.authoritative) {
    return resultBusinessAppCount > 0
  }

  const runtimeBusinessAppCount = businessApplications(runtimeApps).length
  if (!runtimeBusinessAppCount) return true

  return resultBusinessAppCount >= runtimeBusinessAppCount
}

function fallbackApplicationsResponse(
  event: H3Event,
  apps: AppItem[],
  currentApp: AppItem,
  consoleApps: AppItem[]
) {
  const baseApps = apps.length ? apps : [currentApp]
  return {
    code: 0,
    data: sortApplications(mergeApplications(
      baseApps,
      [currentApp, ...portalApplicationsForAuthorization(consoleApps, false)],
      { preferFallbackHomeUrl: true }
    ))
  }
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const currentApp = currentApplication(event)
  const consoleApps = consolePortalApplications(event)
  const localDevMode = loadHzyLocalDevRuntimeMode(event)
  const localDevApps = localDevMode.devApplicationsEnabled ? appsFromLocalDevCatalog(event) : []
  let runtime: ConsoleRuntimeConfig | null = null
  let runtimeApps: AppItem[] = []

  try {
    runtime = await getConsoleRuntimeConfig({ event })
    runtimeApps = appsFromConsoleRuntime(event, runtime.applications || [])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[Applications] Failed to fetch Console runtime applications: ${message}`)
  }

  try {
    if (hasConsoleUserApplicationsAuthorization(event) || !runtimeApps.length) {
      const consoleUserApplications = await fetchConsoleUserApplications(event, runtime)
      if (shouldUseConsoleUserApplications(consoleUserApplications, runtimeApps)) {
        const consoleUserApps = consoleUserApplications.apps
        const canAccessConsole = consoleUserApps.some(app => app.appCode === 'console')
        return {
          code: 0,
          data: sortApplications(mergeApplication(
            mergeApplications(
              consoleUserApps,
              portalApplicationsForAuthorization(consoleApps, canAccessConsole),
              { preferFallbackHomeUrl: true }
            ),
            currentApp,
            { preferFallbackHomeUrl: true, preferFallbackIcon: true }
          ))
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[Applications] Failed to fetch Console user applications: ${message}`)
  }

  if (localDevMode.devApplicationsEnabled) {
    return fallbackApplicationsResponse(
      event,
      localDevApps.length ? localDevApps : runtimeApps,
      currentApp,
      consoleApps
    )
  }

  throw createError({
    statusCode: 503,
    statusMessage: 'Authorization Unavailable',
    message: 'Console user applications unavailable; business applications no longer fall back to local policy bundle'
  })
})
