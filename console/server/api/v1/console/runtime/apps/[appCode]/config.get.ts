import { createError, getHeader, getRequestURL, getRouterParam, type H3Event } from 'h3'
import {
  getCachedBundleInvalidReason,
  readCachedBundle,
  type CachedPolicyBundle
} from '~~/server/utils/bundleCache'
import { getOidcIssuer } from '~~/server/utils/oidc'
import {
  loadPlatformRuntimeConfig,
  refreshPlatformBundle,
  resolvePlatformRuntimeCacheScope
} from '~~/server/utils/platformRuntime'
import { getSystemParameter } from '~~/server/utils/systemParameters'

type BundleRecord = Record<string, unknown>

interface RuntimeAppItem {
  appCode: string
  appName: string
  appDisplayName?: string | null
  description?: string | null
  icon?: string | null
  logo?: string | null
  homeUrl?: string | null
  basePath?: string | null
  apiBase?: string | null
  appType?: string | null
  serviceRole?: string | null
  authMode?: string | null
  sortOrder?: number | null
  status?: string | null
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

function isActive(record: BundleRecord | RuntimeAppItem) {
  const status = stringValue(record.status)
  return !status || status === 'active'
}

function requestOrigin(event: H3Event) {
  const forwardedHost = stringValue(getHeader(event, 'x-forwarded-host')).split(',')[0]?.trim()
  const forwardedProto = stringValue(getHeader(event, 'x-forwarded-proto')).split(',')[0]?.trim()
  const url = getRequestURL(event)
  const protocol = (forwardedProto || url.protocol.replace(/:$/, '') || 'http').replace(/:$/, '')
  const host = forwardedHost || stringValue(getHeader(event, 'host')) || url.host
  return host ? `${protocol}://${host}` : url.origin
}

function normalizeBaseUrl(value: string) {
  return value
    .replace(/[?#].*$/, '')
    .replace(/\/admin\/?$/i, '')
    .replace(/\/+$/, '')
}

function appendPath(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function buildHomeUrl(publicUrl: string | null, basePath: string | null) {
  if (!publicUrl || !basePath) return null
  return `${publicUrl.replace(/\/+$/, '')}/${basePath.replace(/^\/+/, '')}`.replace(/\/?$/, '/')
}

function configuredDeploymentPublicUrl(event: H3Event) {
  const publicConfig = useRuntimeConfig(event).public || {}
  return nullableString(publicConfig.deploymentPublicUrl) || nullableString(process.env.HZY_DEPLOYMENT_PUBLIC_URL)
}

function resolveHomeUrl(event: H3Event, recordHomeUrl: unknown, basePath: string | null, bundleDeploymentPublicUrl: string | null) {
  return buildHomeUrl(bundleDeploymentPublicUrl, basePath)
    || nullableString(recordHomeUrl)
    || buildHomeUrl(configuredDeploymentPublicUrl(event), basePath)
}

function normalizeAppItem(event: H3Event, value: unknown, deploymentPublicUrl: string | null): RuntimeAppItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as BundleRecord
  const appCode = stringValue(record.appCode)
  if (!appCode) return null

  const basePath = nullableString(record.basePath)
  const homeUrl = resolveHomeUrl(event, record.homeUrl, basePath, deploymentPublicUrl)

  return {
    appCode,
    appName: stringValue(record.appName) || appCode,
    appDisplayName: nullableString(record.appDisplayName) || nullableString(record.appName),
    description: nullableString(record.description),
    icon: nullableString(record.icon),
    logo: nullableString(record.logo),
    homeUrl,
    basePath,
    apiBase: nullableString(record.apiBase),
    appType: nullableString(record.appType) || 'business',
    serviceRole: nullableString(record.serviceRole),
    authMode: nullableString(record.authMode),
    sortOrder: Number.isFinite(Number(record.sortOrder)) ? Number(record.sortOrder) : null,
    status: nullableString(record.status)
  }
}

function appsFromBundle(event: H3Event, bundle: CachedPolicyBundle | null) {
  const deployment = bundle?.payload?.deployment as Record<string, unknown> | undefined
  const deploymentPublicUrl = nullableString(deployment?.publicUrl)

  return records(bundle?.payload?.applications)
    .map(item => normalizeAppItem(event, item, deploymentPublicUrl))
    .filter((item): item is RuntimeAppItem => Boolean(item))
    .filter(isActive)
    .sort((a, b) => appSortOrder(a) - appSortOrder(b) || a.appCode.localeCompare(b.appCode))
}

function fallbackApp(appCode: string): RuntimeAppItem {
  return {
    appCode,
    appName: appCode,
    appDisplayName: appCode,
    appType: 'business',
    status: 'active'
  }
}

function appSortOrder(app: RuntimeAppItem) {
  const value = Number(app.sortOrder)
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
}

export default defineEventHandler(async (event) => {
  const appCode = stringValue(getRouterParam(event, 'appCode'))
  if (!appCode) {
    throw createError({ statusCode: 400, message: 'appCode is required' })
  }

  let bundle: CachedPolicyBundle | null = null
  let tenantCode: string | null = null
  let deploymentCode: string | null = null
  let bundleError: string | null = null

  try {
    const platformConfig = loadPlatformRuntimeConfig(event)
    tenantCode = platformConfig.tenantCode
    deploymentCode = platformConfig.deploymentCode
    const cacheScope = resolvePlatformRuntimeCacheScope(platformConfig, event)
    let cached = await readCachedBundle(platformConfig.bundleCacheDir, cacheScope)
    let invalidReason = getCachedBundleInvalidReason(cached)
    if (platformConfig.activationMode === 'managed-cloud-multitenant' && invalidReason) {
      const refreshed = await refreshPlatformBundle('runtime-config-cache-miss', event).catch(() => null)
      if (refreshed?.ok && refreshed.bundle) {
        cached = refreshed.bundle
        invalidReason = getCachedBundleInvalidReason(cached)
      }
    }
    if (cached && !invalidReason) {
      bundle = cached
      tenantCode = cached.tenantCode
      deploymentCode = cached.deploymentCode
    } else {
      bundleError = invalidReason
    }
  } catch (error) {
    bundleError = error instanceof Error ? error.message : String(error)
  }

  const applications = appsFromBundle(event, bundle)
  const app = applications.find(item => item.appCode === appCode) || fallbackApp(appCode)
  const deployment = bundle?.payload?.deployment as Record<string, unknown> | undefined
  const consoleBaseUrl = normalizeBaseUrl(requestOrigin(event))
  const [workflowApiUrl, notificationRuntimeApiUrl] = await Promise.all([
    getSystemParameter('workflow.apiUrl').catch(() => null),
    getSystemParameter('notification.runtimeApiUrl').catch(() => null)
  ])

  return {
    code: 0,
    data: {
      schemaVersion: 'console-runtime.v1',
      app,
      console: {
        baseUrl: consoleBaseUrl,
        issuer: getOidcIssuer(event),
        tokenUrl: appendPath(consoleBaseUrl, '/oauth/token'),
        bootstrapTokenUrl: appendPath(consoleBaseUrl, '/api/v1/console/bootstrap/token'),
        authMeUrl: appendPath(consoleBaseUrl, '/api/v1/console/auth/me'),
        directoryApiUrl: appendPath(consoleBaseUrl, '/api/v1/console/directory'),
        settingsApiUrl: appendPath(consoleBaseUrl, '/api/v1/console/settings'),
        integrationsApiUrl: appendPath(consoleBaseUrl, '/api/v1/console/integrations'),
        userApplicationsUrl: appendPath(consoleBaseUrl, '/api/user/applications')
      },
      tenant: {
        tenantCode: bundle?.tenantCode || tenantCode
      },
      deployment: {
        deploymentCode: bundle?.deploymentCode || deploymentCode,
        publicUrl: nullableString(deployment?.publicUrl),
        basePath: app.basePath || null
      },
      workflow: {
        apiUrl: workflowApiUrl
      },
      notification: {
        apiUrl: notificationRuntimeApiUrl
      },
      applications,
      bundle: bundle
        ? {
            bundleVersion: bundle.bundleVersion,
            bundleHash: bundle.bundleHash,
            status: bundle.status,
            cachedAt: bundle.cachedAt
          }
        : {
            bundleVersion: null,
            bundleHash: null,
            status: bundleError ? 'unavailable' : null,
            cachedAt: null
          },
      fetchedAt: new Date().toISOString()
    }
  }
})
