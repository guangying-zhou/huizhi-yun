import { createError, getHeader, type H3Event } from 'h3'
import { getRequestOrigin } from './appUrls'

export interface ConsoleRuntimeApp {
  appCode: string
  appName: string
  appDisplayName?: string | null
  description?: string | null
  icon?: string | null
  logo?: string | null
  homeUrl?: string | null
  basePath?: string | null
  apiBase?: string | null
  sortOrder?: number | null
  appType?: string | null
  serviceRole?: string | null
  authMode?: string | null
  status?: string | null
}

export interface ConsoleRuntimeConfig {
  schemaVersion: 'console-runtime.v1'
  app: ConsoleRuntimeApp
  console: {
    baseUrl: string
    issuer?: string | null
    tokenUrl: string
    bootstrapTokenUrl: string
    authMeUrl: string
    directoryApiUrl: string
    settingsApiUrl: string
    integrationsApiUrl: string
    userApplicationsUrl: string
  }
  tenant?: {
    tenantCode?: string | null
  }
  deployment?: {
    deploymentCode?: string | null
    publicUrl?: string | null
    basePath?: string | null
  }
  workflow?: {
    apiUrl?: string | null
  }
  notification?: {
    apiUrl?: string | null
  }
  applications?: ConsoleRuntimeApp[]
  bundle?: {
    bundleVersion?: string | null
    bundleHash?: string | null
    status?: string | null
    cachedAt?: string | null
  }
  fetchedAt: string
}

interface RuntimeConfigShape {
  hzy?: Record<string, unknown>
  public?: Record<string, unknown>
}

interface ConsoleRuntimeSeedConfig {
  enabled: boolean
  appCode: string
  consoleApiUrl: string
  timeoutMs: number
  ttlMs: number
}

interface ConsoleRuntimeCacheEntry {
  value: ConsoleRuntimeConfig
  expiresAt: number
}

interface ConsoleRuntimeEnvelope {
  code?: number
  data?: ConsoleRuntimeConfig
  message?: string
}

type CloudflareEnv = Record<string, unknown>

type CloudflareRuntimeEvent = H3Event & {
  context?: H3Event['context'] & {
    cloudflare?: {
      env?: CloudflareEnv
    }
    _platform?: {
      cloudflare?: {
        env?: CloudflareEnv
      }
    }
  }
  req?: {
    runtime?: {
      cloudflare?: {
        env?: CloudflareEnv
      }
    }
  }
}

const runtimeCache = new Map<string, ConsoleRuntimeCacheEntry>()
const RESERVED_TENANT_SUBDOMAINS = new Set([
  'admin',
  'aims',
  'align',
  'altoc',
  'api',
  'app',
  'apps',
  'assets',
  'auth',
  'billing',
  'cdn',
  'cdn-cgi',
  'codocs',
  'collab',
  'console',
  'dashboard',
  'dev',
  'docs',
  'downloads',
  'finance',
  'help',
  'hrm',
  'id',
  'insights',
  'login',
  'mail',
  'oauth',
  'observability',
  'platform',
  'root',
  'rum',
  'sso',
  'static',
  'status',
  'staging',
  'support',
  'test',
  'webdev',
  'workflow',
  'www'
])

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function cloudflareEnv(event?: H3Event | null): CloudflareEnv {
  if (!event) return {}
  const runtimeEvent = event as CloudflareRuntimeEvent
  return runtimeEvent.context?.cloudflare?.env
    || runtimeEvent.context?._platform?.cloudflare?.env
    || runtimeEvent.req?.runtime?.cloudflare?.env
    || {}
}

function envValue(event: H3Event | null | undefined, names: string[]) {
  const cfEnv = cloudflareEnv(event)
  for (const name of names) {
    const cfValue = stringValue(cfEnv[name])
    if (cfValue) return cfValue
  }
  for (const name of names) {
    const processValue = stringValue(process.env[name])
    if (processValue) return processValue
  }
  return ''
}

function getNestedRecord(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function getConfigValue(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    let current: unknown = config
    for (const part of key.split('.')) {
      if (!current || typeof current !== 'object') {
        current = undefined
        break
      }
      current = (current as Record<string, unknown>)[part]
    }

    const normalized = stringValue(current)
    if (normalized) return normalized
  }

  return ''
}

function boolFromValue(value: unknown) {
  const normalized = stringValue(value).toLowerCase()
  if (!normalized) return null
  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

function normalizeBaseUrl(value: string) {
  return value
    .replace(/[?#].*$/, '')
    .replace(/\/admin\/?$/i, '')
    .replace(/\/+$/, '')
}

function tenantDomainSuffix() {
  return stringValue(process.env.HZY_TENANT_DOMAIN_SUFFIX || 'huizhi.yun')
    .replace(/^\.+|\.+$/g, '')
    .toLowerCase()
}

function isAllowedTenantGatewayHost(host: string) {
  const normalized = host.toLowerCase().replace(/:\d+$/, '')
  const suffix = tenantDomainSuffix()
  return Boolean(normalized && suffix && normalized.endsWith(`.${suffix}`))
}

function isReservedTenantGatewayHost(host: string) {
  const normalized = host.toLowerCase().replace(/:\d+$/, '')
  const suffix = tenantDomainSuffix()
  if (!normalized || !suffix || !normalized.endsWith(`.${suffix}`)) {
    return true
  }

  const subdomain = normalized.slice(0, -1 * (`.${suffix}`).length)
  return !subdomain || subdomain.includes('.') || RESERVED_TENANT_SUBDOMAINS.has(subdomain)
}

function isTenantGatewayBaseUrl(value: string) {
  const normalized = normalizeBaseUrl(value)
  if (!normalized) return false

  try {
    const host = new URL(normalized).host
    return isAllowedTenantGatewayHost(host) && !isReservedTenantGatewayHost(host)
  } catch {
    return false
  }
}

function resolveServerConsoleBaseUrl(cachedBaseUrl: string, seedBaseUrl: string) {
  const cached = normalizeBaseUrl(cachedBaseUrl)
  const seed = normalizeBaseUrl(seedBaseUrl)

  if (cached && seed && isTenantGatewayBaseUrl(cached) && !isTenantGatewayBaseUrl(seed)) {
    return seed
  }

  return cached || seed
}

export function resolveTenantGatewayConsoleOrigin(event?: H3Event | null) {
  if (!event) {
    return ''
  }

  const gateway = stringValue(getHeader(event, 'x-hzy-gateway'))
  const requestOrigin = normalizeBaseUrl(getRequestOrigin(event))
  const explicitForwardedHost = stringValue(getHeader(event, 'x-hzy-forwarded-host')).split(',')[0]?.trim() || ''
  const explicitForwardedProto = stringValue(getHeader(event, 'x-hzy-forwarded-proto')).split(',')[0]?.trim() || ''
  const requestHost = (() => {
    try {
      return new URL(requestOrigin).host
    } catch {
      return ''
    }
  })()
  const forwardedHost = explicitForwardedHost || stringValue(getHeader(event, 'x-forwarded-host')).split(',')[0]?.trim() || ''
  const candidateHost = forwardedHost || requestHost

  if (!candidateHost || !isAllowedTenantGatewayHost(candidateHost)) {
    return ''
  }

  if (gateway !== 'tenant-gateway' && isReservedTenantGatewayHost(candidateHost)) {
    return ''
  }

  const protocol = (() => {
    const normalized = explicitForwardedProto.toLowerCase().replace(/:$/, '')
    if (normalized === 'http' || normalized === 'https') return normalized
    try {
      return new URL(requestOrigin).protocol.replace(/:$/, '') || 'https'
    } catch {
      return 'https'
    }
  })()
  return `${protocol}://${candidateHost}`
}

function appendPath(baseUrl: string, path: string) {
  if (!baseUrl) return ''
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function tenantGatewayRequestHeaders(event?: H3Event | null) {
  if (!event) return undefined

  const headers: Record<string, string> = {}
  for (const name of [
    'x-hzy-gateway',
    'x-hzy-gateway-token',
    'x-hzy-tenant',
    'x-hzy-deployment',
    'x-hzy-environment',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-prefix',
    'x-forwarded-proto'
  ]) {
    const value = stringValue(getHeader(event, name))
    if (value) headers[name] = value
  }

  return Object.keys(headers).length ? headers : undefined
}

function fallbackApp(config: Record<string, unknown>, appCode: string): ConsoleRuntimeApp {
  return {
    appCode,
    appName: getConfigValue(config, ['public.appDisplayName', 'public.appName']) || appCode,
    appDisplayName: getConfigValue(config, ['public.appDisplayName']) || null,
    icon: getConfigValue(config, ['public.appIcon']) || null,
    logo: getConfigValue(config, ['public.appLogo']) || null,
    homeUrl: getConfigValue(config, ['public.appHomeUrl']) || null,
    basePath: getConfigValue(config, ['public.appBasePath']) || null,
    sortOrder: null,
    appType: 'business',
    status: 'active'
  }
}

function fallbackRuntimeConfig(config: Record<string, unknown>, seed: ConsoleRuntimeSeedConfig): ConsoleRuntimeConfig {
  const consoleBaseUrl = normalizeBaseUrl(seed.consoleApiUrl)
  const issuer = normalizeBaseUrl(getConfigValue(config, [
    'public.deploymentPublicUrl',
    'hzy.deploymentPublicUrl'
  ]) || consoleBaseUrl)

  return {
    schemaVersion: 'console-runtime.v1',
    app: fallbackApp(config, seed.appCode || 'app'),
    console: {
      baseUrl: consoleBaseUrl,
      issuer,
      tokenUrl: appendPath(consoleBaseUrl, '/oauth/token'),
      bootstrapTokenUrl: appendPath(consoleBaseUrl, '/api/v1/console/bootstrap/token'),
      authMeUrl: appendPath(consoleBaseUrl, '/api/v1/console/auth/me'),
      directoryApiUrl: appendPath(consoleBaseUrl, '/api/v1/console/directory'),
      settingsApiUrl: appendPath(consoleBaseUrl, '/api/v1/console/settings'),
      integrationsApiUrl: appendPath(consoleBaseUrl, '/api/v1/console/integrations'),
      userApplicationsUrl: appendPath(consoleBaseUrl, '/api/user/applications')
    },
    tenant: {},
    deployment: {
      publicUrl: getConfigValue(config, ['public.deploymentPublicUrl']) || null,
      basePath: getConfigValue(config, ['public.appBasePath']) || null
    },
    workflow: {},
    notification: {
      apiUrl: getConfigValue(config, [
        'hzy.notificationRuntime.apiUrl',
        'hzy.notificationRuntime.url',
        'notificationRuntime.apiUrl',
        'notificationRuntime.url',
        'hzy.notification.apiUrl',
        'notification.apiUrl'
      ]) || envValue(null, [
        'HZY_NOTIFICATION_RUNTIME_API_URL',
        'HZY_NOTIFICATION_RUNTIME_URL'
      ]) || null
    },
    applications: [],
    fetchedAt: new Date().toISOString()
  }
}

function normalizeConsoleRuntimeForServer(runtime: ConsoleRuntimeConfig, seed: ConsoleRuntimeSeedConfig) {
  const consoleBaseUrl = resolveServerConsoleBaseUrl(runtime.console.baseUrl, seed.consoleApiUrl)
  if (!consoleBaseUrl || consoleBaseUrl === normalizeBaseUrl(runtime.console.baseUrl)) {
    return runtime
  }

  return {
    ...runtime,
    console: {
      ...runtime.console,
      baseUrl: consoleBaseUrl,
      tokenUrl: appendPath(consoleBaseUrl, '/oauth/token'),
      bootstrapTokenUrl: appendPath(consoleBaseUrl, '/api/v1/console/bootstrap/token'),
      authMeUrl: appendPath(consoleBaseUrl, '/api/v1/console/auth/me'),
      directoryApiUrl: appendPath(consoleBaseUrl, '/api/v1/console/directory'),
      settingsApiUrl: appendPath(consoleBaseUrl, '/api/v1/console/settings'),
      integrationsApiUrl: appendPath(consoleBaseUrl, '/api/v1/console/integrations'),
      userApplicationsUrl: appendPath(consoleBaseUrl, '/api/user/applications')
    }
  }
}

export function resolveConsoleRuntimeSeedConfig(
  config = useRuntimeConfig() as unknown as RuntimeConfigShape,
  event?: H3Event | null
): ConsoleRuntimeSeedConfig {
  const record = config as Record<string, unknown>
  const hzy = config.hzy || {}
  const consoleRuntime = getNestedRecord(hzy, 'consoleRuntime') || {}
  const appCode = getConfigValue(record, [
    'hzy.appCode',
    'public.appCode',
    'public.appName'
  ]) || envValue(event, ['HZY_APP_CODE', 'APP_CODE'])

  const configuredConsoleUrl = getConfigValue(record, [
    'hzy.consoleRuntime.consoleApiUrl',
    'hzy.runtime.consoleApiUrl',
    'hzy.directory.consoleApiUrl',
    'hzy.integration.consoleApiUrl',
    'hzy.consoleApiUrl',
    'hzy.consoleUrl',
    'public.consoleUrl'
  ])
  const envConsoleUrl = envValue(event, ['HZY_CONSOLE_API_URL', 'HZY_CONSOLE_URL', 'NUXT_PUBLIC_CONSOLE_URL'])
  const runtimeApiUrl = envValue(event, ['HZY_CONSOLE_RUNTIME_API_URL'])
  const configuredRuntimeApiUrl = getConfigValue(record, ['hzy.consoleRuntime.consoleApiUrl'])

  const deploymentPublicUrl = getConfigValue(record, [
    'public.deploymentPublicUrl',
    'hzy.deploymentPublicUrl'
  ]) || envValue(event, ['HZY_DEPLOYMENT_PUBLIC_URL'])
  const tenantGatewayConsoleUrl = resolveTenantGatewayConsoleOrigin(event)

  const consoleApiUrl = normalizeBaseUrl(
    runtimeApiUrl
    || tenantGatewayConsoleUrl
    || envConsoleUrl
    || configuredRuntimeApiUrl
    || configuredConsoleUrl
    || deploymentPublicUrl
    || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000')
  )

  const explicitEnabled = boolFromValue(
    consoleRuntime.enabled
    ?? hzy.consoleRuntimeEnabled
    ?? envValue(event, ['HZY_CONSOLE_RUNTIME_ENABLED'])
  )
  const enabled = explicitEnabled ?? (appCode !== 'console')

  return {
    enabled,
    appCode,
    consoleApiUrl,
    timeoutMs: Number(consoleRuntime.timeoutMs || envValue(event, ['HZY_CONSOLE_RUNTIME_TIMEOUT_MS']) || 5000),
    ttlMs: Math.max(5000, Number(consoleRuntime.ttlMs || envValue(event, ['HZY_CONSOLE_RUNTIME_TTL_MS']) || 60000))
  }
}

export function getCachedConsoleRuntimeConfig() {
  const now = Date.now()
  for (const entry of runtimeCache.values()) {
    if (entry.expiresAt > now) {
      return entry.value
    }
  }
  return null
}

export function resolveConsoleRuntimeBaseUrl(
  config = useRuntimeConfig() as unknown as RuntimeConfigShape,
  event?: H3Event | null
) {
  return normalizeBaseUrl(
    resolveServerConsoleBaseUrl(
      getCachedConsoleRuntimeConfig()?.console.baseUrl || '',
      resolveConsoleRuntimeSeedConfig(config, event).consoleApiUrl
    )
  )
}

export function resolveConsoleRuntimeTokenUrl(
  config = useRuntimeConfig() as unknown as RuntimeConfigShape,
  event?: H3Event | null
) {
  const cached = getCachedConsoleRuntimeConfig()
  const seed = resolveConsoleRuntimeSeedConfig(config, event)
  const serverBaseUrl = resolveServerConsoleBaseUrl(cached?.console.baseUrl || '', seed.consoleApiUrl)
  if (
    cached?.console.tokenUrl
    && (!isTenantGatewayBaseUrl(cached.console.tokenUrl) || isTenantGatewayBaseUrl(serverBaseUrl))
  ) {
    return cached.console.tokenUrl
  }
  if (serverBaseUrl) return appendPath(serverBaseUrl, '/oauth/token')
  const baseUrl = resolveConsoleRuntimeBaseUrl(config, event)
  return baseUrl ? appendPath(baseUrl, '/oauth/token') : ''
}

export async function getConsoleRuntimeConfig(options: {
  forceRefresh?: boolean
  allowFallback?: boolean
  event?: H3Event | null
} = {}) {
  const config = useRuntimeConfig() as unknown as RuntimeConfigShape
  const record = config as Record<string, unknown>
  const seed = resolveConsoleRuntimeSeedConfig(config, options.event)
  const cacheKey = `${seed.consoleApiUrl}|${seed.appCode}`
  const cached = runtimeCache.get(cacheKey)
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  if (!seed.enabled) {
    const fallback = fallbackRuntimeConfig(record, seed)
    runtimeCache.set(cacheKey, {
      value: fallback,
      expiresAt: Date.now() + seed.ttlMs
    })
    return fallback
  }

  if (!seed.appCode || !seed.consoleApiUrl) {
    if (options.allowFallback !== false) {
      return fallbackRuntimeConfig(record, seed)
    }
    throw createError({ statusCode: 503, message: 'Console runtime config is not configured' })
  }

  try {
    const response = await $fetch<ConsoleRuntimeEnvelope>(
      `${seed.consoleApiUrl}/api/v1/console/runtime/apps/${encodeURIComponent(seed.appCode)}/config`,
      {
        headers: tenantGatewayRequestHeaders(options.event),
        timeout: seed.timeoutMs
      }
    )

    if (response.code !== undefined && response.code !== 0) {
      throw createError({
        statusCode: 502,
        message: response.message || 'Console runtime API returned an error'
      })
    }

    if (!response.data?.console?.baseUrl) {
      throw createError({ statusCode: 502, message: 'Console runtime API response is invalid' })
    }

    const value = normalizeConsoleRuntimeForServer(response.data, seed)
    runtimeCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + seed.ttlMs
    })
    return value
  } catch (error) {
    if (options.allowFallback === false) {
      throw error
    }

    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[ConsoleRuntime] Failed to fetch runtime config for ${seed.appCode || 'app'} from ${seed.consoleApiUrl || 'unconfigured'}: ${message}`)

    if (cached?.value?.console?.baseUrl) {
      runtimeCache.set(cacheKey, {
        value: cached.value,
        expiresAt: Date.now() + Math.min(seed.ttlMs, 15000)
      })
      return cached.value
    }

    const fallback = fallbackRuntimeConfig(record, seed)
    runtimeCache.set(cacheKey, {
      value: fallback,
      expiresAt: Date.now() + Math.min(seed.ttlMs, 15000)
    })
    return fallback
  }
}
