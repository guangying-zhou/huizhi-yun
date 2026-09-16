import { createError, type H3Event } from 'h3'
import { resolveHzyDevApplications } from '@hzy/foundation/server/utils/devApplications'
import { buildAllowedAppCodesFromPolicyBundle } from '@hzy/foundation/server/utils/applicationAuthorization'
import { fetchExternal } from '@hzy/foundation/server/utils/externalFetch'
import {
  hasPermissionInSnapshot,
  loadPolicyAuthorizationSnapshot
} from '~~/server/utils/policyAuthorization'
import {
  getCachedBundleInvalidReason,
  readCachedBundle,
  type CachedPolicyBundle
} from '~~/server/utils/bundleCache'
import {
  loadConsoleRuntimeMode,
  loadPlatformRuntimeConfig,
  refreshPlatformBundle,
  resolvePlatformRuntimeCacheScope,
  type PlatformRuntimeConfig
} from '~~/server/utils/platformRuntime'

export interface ConsoleUserApplication {
  appCode: string
  appName: string
  description: string | null
  icon: string | null
  homeUrl: string | null
  basePath?: string | null
  sortOrder?: number | null
  appType: string
  status?: string | null
}

interface RuntimeApplicationsResponse {
  success?: boolean
  data?: {
    items?: ConsoleUserApplication[]
  }
}

type BundleRecord = Record<string, unknown>

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

function isActive(record: BundleRecord | ConsoleUserApplication) {
  const status = stringValue(record.status)
  return !status || status === 'active'
}

function normalizePublicUrl(value: unknown) {
  const normalized = stringValue(value).replace(/\/+$/, '')
  if (!normalized) return null

  try {
    const url = new URL(normalized)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

function normalizeBasePath(value: unknown) {
  const normalized = stringValue(value)
  if (!normalized) return null
  if (normalized === '/') return '/'
  if (!normalized.startsWith('/')) return null
  if (normalized.includes('://') || normalized.includes('?') || normalized.includes('#')) return null
  if (/\s/.test(normalized) || normalized.includes('..') || normalized.includes('//')) return null
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

function buildAppHomeUrl(publicUrl: unknown, basePath: unknown) {
  const origin = normalizePublicUrl(publicUrl)
  const path = normalizeBasePath(basePath)
  if (!origin || !path) return null
  return `${origin}${path === '/' ? '/' : path}`
}

function configuredDeploymentPublicUrl(event: H3Event) {
  const publicConfig = useRuntimeConfig(event).public || {}
  return normalizePublicUrl(publicConfig.deploymentPublicUrl || process.env.HZY_DEPLOYMENT_PUBLIC_URL)
}

function resolveAppHomeUrl(event: H3Event, recordHomeUrl: unknown, basePath: unknown, bundleDeploymentPublicUrl?: string | null) {
  return nullableString(recordHomeUrl)
    || buildAppHomeUrl(bundleDeploymentPublicUrl, basePath)
    || buildAppHomeUrl(configuredDeploymentPublicUrl(event), basePath)
}

function currentConsoleApp(event: H3Event): ConsoleUserApplication {
  const config = useRuntimeConfig(event)
  const publicConfig = config.public || {}
  const appCode = stringValue(publicConfig.appCode) || 'console'

  return {
    appCode,
    appName: stringValue(publicConfig.appDisplayName) || stringValue(publicConfig.appName) || '控制台',
    description: null,
    icon: nullableString(publicConfig.appIcon) || 'i-lucide-monitor-cog',
    homeUrl: '/admin',
    basePath: '/',
    sortOrder: 0,
    appType: 'base_runtime',
    status: 'active'
  }
}

function normalizeAppItem(event: H3Event, value: unknown, deploymentPublicUrl?: string | null): ConsoleUserApplication | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as BundleRecord
  const appCode = stringValue(record.appCode)
  if (!appCode) return null
  const basePath = nullableString(record.basePath)

  return {
    appCode,
    appName: stringValue(record.appName) || appCode,
    description: nullableString(record.description),
    icon: nullableString(record.icon),
    homeUrl: resolveAppHomeUrl(event, record.homeUrl, basePath, deploymentPublicUrl),
    basePath,
    sortOrder: Number.isFinite(Number(record.sortOrder)) ? Number(record.sortOrder) : null,
    appType: stringValue(record.appType) || 'business',
    status: nullableString(record.status)
  }
}

function mergeCurrentConsoleApp(apps: ConsoleUserApplication[], currentApp: ConsoleUserApplication) {
  const existing = apps.find(app => app.appCode === currentApp.appCode)
  if (!existing) {
    return [currentApp, ...apps]
  }

  return apps.map(app => app.appCode === currentApp.appCode
    ? {
        ...app,
        appName: app.appName || currentApp.appName,
        icon: app.icon || currentApp.icon,
        homeUrl: currentApp.homeUrl,
        basePath: currentApp.basePath,
        sortOrder: app.sortOrder ?? currentApp.sortOrder,
        appType: app.appType || currentApp.appType
      }
    : app)
}

function appSortOrder(app: ConsoleUserApplication) {
  const value = Number(app.sortOrder)
  if (Number.isFinite(value)) return value
  if (app.appCode === 'console') return 0
  return Number.MAX_SAFE_INTEGER
}

function configuredConsoleDevApplications(): ConsoleUserApplication[] {
  return resolveHzyDevApplications({ logPrefix: '[Applications]' })
}

function localDevConsoleApp(currentApp: ConsoleUserApplication): ConsoleUserApplication {
  return {
    ...currentApp,
    appName: '控制台',
    homeUrl: '/admin',
    basePath: '/',
    sortOrder: Number.MAX_SAFE_INTEGER
  }
}

function localDevAppSortOrder(app: ConsoleUserApplication) {
  if (app.appCode === 'console') return Number.MAX_SAFE_INTEGER + 1
  return appSortOrder(app)
}

function consoleDevApplications(currentApp: ConsoleUserApplication) {
  return mergeCurrentConsoleApp(configuredConsoleDevApplications(), localDevConsoleApp(currentApp))
    .filter(isActive)
    .sort((a, b) => localDevAppSortOrder(a) - localDevAppSortOrder(b) || a.appCode.localeCompare(b.appCode))
}

export async function getConsoleApplicationCatalog(event: H3Event) {
  const currentApp = currentConsoleApp(event)
  const runtimeMode = loadConsoleRuntimeMode(event)
  if (runtimeMode.devPolicyBypassEnabled) return consoleDevApplications(currentApp)

  const runtimeConfig = loadPlatformRuntimeConfig(event)
  const cacheScope = resolvePlatformRuntimeCacheScope(runtimeConfig, event)
  let bundle = await readCachedBundle(runtimeConfig.bundleCacheDir, cacheScope)
  let invalidReason = getCachedBundleInvalidReason(bundle)
  if (runtimeConfig.activationMode === 'managed-cloud-multitenant' && invalidReason) {
    const refresh = await refreshPlatformBundle('notification-action-target-cache-miss', event).catch(() => null)
    if (refresh?.ok && refresh.bundle) {
      bundle = refresh.bundle
      invalidReason = getCachedBundleInvalidReason(bundle)
    }
  }
  if (!bundle || invalidReason) {
    throw createError({ statusCode: 503, message: 'Signed application route catalog is unavailable' })
  }
  return mergeCurrentConsoleApp(appsFromBundle(event, bundle), currentApp)
}

function shouldShowApp(app: ConsoleUserApplication, allowedAppCodes: Set<string>) {
  return allowedAppCodes.has(app.appCode)
}

async function buildApplicationAuthorization(event: H3Event, uid: string, bundle: CachedPolicyBundle) {
  const snapshot = await loadPolicyAuthorizationSnapshot(uid, 'console', event)
  const authorizationMode = snapshot.authorizationMode
  const applicationSelection = buildAllowedAppCodesFromPolicyBundle({
    payload: snapshot.payload || bundle.payload,
    uid: snapshot.uid,
    requestedRoleCode: snapshot.activeRoleCode,
    authorizationMode,
    allowRoleSimulation: authorizationMode === 'role_simulation',
    allowUserSimulation: authorizationMode === 'user_simulation',
    includeBaseline: snapshot.includeBaseline
  })

  return {
    allowedAppCodes: applicationSelection.allowedAppCodes,
    canAccessConsole: hasPermissionInSnapshot(snapshot, 'console_overview', 'view')
  }
}

function appsFromBundle(event: H3Event, bundle: CachedPolicyBundle) {
  const deployment = bundle.payload?.deployment as Record<string, unknown> | undefined
  const deploymentPublicUrl = nullableString(deployment?.publicUrl)

  return records(bundle.payload?.applications)
    .map(item => normalizeAppItem(event, item, deploymentPublicUrl))
    .filter((item): item is ConsoleUserApplication => Boolean(item))
    .filter(isActive)
}

async function fetchRuntimeApplications(event: H3Event, config: PlatformRuntimeConfig) {
  type RuntimeApplicationsFetch = (
    url: string,
    options: Record<string, unknown>
  ) => Promise<RuntimeApplicationsResponse>
  const fetchApplications = fetchExternal as unknown as RuntimeApplicationsFetch
  const response = await fetchApplications(
    `${config.baseUrl.replace(/\/$/, '')}/api/platform/runtime/applications`,
    {
      query: {
        tenantCode: config.tenantCode,
        deploymentCode: config.deploymentCode,
        status: 'active'
      },
      headers: {
        Authorization: `Bearer ${config.runtimeToken}`
      },
      timeout: 5000
    }
  )

  return (response.data?.items || [])
    .map(item => normalizeAppItem(event, item))
    .filter((item): item is ConsoleUserApplication => Boolean(item))
    .filter(isActive)
}

export async function getConsoleUserApplications(event: H3Event, uid: string) {
  const currentApp = currentConsoleApp(event)
  const normalizedUid = stringValue(uid)
  if (!normalizedUid) return [currentApp]

  const runtimeMode = loadConsoleRuntimeMode(event)
  if (runtimeMode.devPolicyBypassEnabled) {
    return consoleDevApplications(currentApp)
  }

  let runtimeConfig: PlatformRuntimeConfig
  try {
    runtimeConfig = loadPlatformRuntimeConfig(event)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw createError({
      statusCode: 503,
      statusMessage: 'Authorization Unavailable',
      message
    })
  }

  const cacheScope = resolvePlatformRuntimeCacheScope(runtimeConfig, event)
  let bundle = await readCachedBundle(runtimeConfig.bundleCacheDir, cacheScope)
  let invalidReason = getCachedBundleInvalidReason(bundle)
  if (runtimeConfig.activationMode === 'managed-cloud-multitenant' && invalidReason) {
    const refresh = await refreshPlatformBundle('user-applications-cache-miss', event).catch(() => null)
    if (refresh?.ok && refresh.bundle) {
      bundle = refresh.bundle
      invalidReason = getCachedBundleInvalidReason(bundle)
    }
  }
  if (!bundle || invalidReason) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Authorization Unavailable',
      message: invalidReason || 'Signed policy bundle is unavailable'
    })
  }

  const { allowedAppCodes, canAccessConsole } = await buildApplicationAuthorization(event, normalizedUid, bundle)
  const bundleApps = appsFromBundle(event, bundle)

  let apps = bundleApps
  if (runtimeConfig.activationMode !== 'managed-cloud-multitenant') {
    try {
      const runtimeApps = await fetchRuntimeApplications(event, runtimeConfig)
      if (runtimeApps.length) {
        apps = runtimeApps
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Applications] Failed to fetch Platform runtime applications, using policy bundle cache: ${message}`)
    }
  }

  return mergeCurrentConsoleApp(apps, currentApp)
    .filter(app => app.appCode === 'console'
      ? canAccessConsole
      : shouldShowApp(app, allowedAppCodes))
    .sort((a, b) => appSortOrder(a) - appSortOrder(b) || a.appCode.localeCompare(b.appCode))
}
