import { getHeader, type H3Event } from 'h3'
import { resolveTrustedTenantGatewayContext } from './tenantGatewayTrust'

const LOCAL_APP_PORTS: Record<string, number> = {
  console: 3000,
  codocs: 3001,
  aims: 3002,
  altoc: 3003,
  assets: 3004,
  finance: 3006,
  people: 3007,
  insights: 3009,
  workflow: 3020
}

const DEFAULT_MANAGED_DOMAIN_SUFFIX = 'huizhi.yun'

type CloudflareEnv = Record<string, unknown>

export interface TrustedServiceAppRoute {
  appCode: string
  origin: string
  basePath: string
  baseUrl: string
  deploymentCode: string
}

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

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function normalizeAppCode(value: string) {
  return stringValue(value).replace(/[^a-z0-9-]/gi, '').toLowerCase()
}

function appEnvPart(appCode: string) {
  return appCode.replace(/[^a-z0-9]/gi, '_').toUpperCase()
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function normalizeBaseUrl(value: unknown) {
  const raw = trimTrailingSlash(stringValue(value))
  if (!raw || !/^https?:\/\//i.test(raw)) return ''
  return raw
}

function normalizeRouteOrigin(value: unknown) {
  const raw = stringValue(value)
  if (!raw || raw.length > 2048) return ''
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    if ((url.pathname && url.pathname !== '/') || url.search || url.hash) return ''
    return url.origin
  } catch {
    return ''
  }
}

function safeDeploymentCode(value: unknown) {
  const code = stringValue(value)
  if (!code || code.length > 128) return ''
  for (let index = 0; index < code.length; index += 1) {
    const charCode = code.charCodeAt(index)
    if (charCode < 32 || charCode === 127) return ''
  }
  return code
}

function normalizeBasePath(value: unknown, appCode: string) {
  const candidate = stringValue(value)
  const raw = candidate && /^\/[a-z0-9/_-]{1,128}\/?$/i.test(candidate)
    ? candidate
    : `/${appCode}/`
  const normalized = `/${raw.replace(/^\/+|\/+$/g, '')}/`
  return normalized === '//'
    ? '/'
    : normalized
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
    const value = stringValue(cfEnv[name])
    if (value) return value
  }
  for (const name of names) {
    const value = stringValue(process.env[name])
    if (value) return value
  }
  return ''
}

function configValue(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    let current: unknown = config
    for (const part of key.split('.')) {
      if (!current || typeof current !== 'object') {
        current = undefined
        break
      }
      current = (current as Record<string, unknown>)[part]
    }
    const value = stringValue(current)
    if (value) return value
  }
  return ''
}

function appendBasePath(baseUrl: string, basePath: string) {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) return ''

  try {
    const url = new URL(normalized)
    const currentPath = url.pathname.replace(/\/+$/g, '')
    const wantedPath = basePath.replace(/\/+$/g, '')
    if (!currentPath || currentPath === '/') {
      url.pathname = basePath
    } else if (currentPath !== wantedPath) {
      return trimTrailingSlash(url.toString())
    }
    url.search = ''
    url.hash = ''
    return trimTrailingSlash(url.toString())
  } catch {
    return normalized
  }
}

function suffixFromUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    const parts = hostname.split('.').filter(Boolean)
    if (parts.length < 3) return ''
    if (hostname.endsWith('.workers.dev')) return ''
    return parts.slice(1).join('.')
  } catch {
    return ''
  }
}

function managedDomainSuffix(event: H3Event | null | undefined, config: Record<string, unknown>) {
  return envValue(event, [
    'HZY_APP_ORIGIN_DOMAIN_SUFFIX',
    'HZY_MANAGED_APP_ORIGIN_DOMAIN_SUFFIX',
    'HZY_TENANT_DOMAIN_SUFFIX'
  ]) || suffixFromUrl(envValue(event, [
    'HZY_CONSOLE_URL',
    'HZY_CONSOLE_API_URL',
    'NUXT_PUBLIC_CONSOLE_URL'
  ]) || configValue(config, [
    'hzy.consoleUrl',
    'public.consoleUrl',
    'hzy.directory.consoleApiUrl'
  ])) || DEFAULT_MANAGED_DOMAIN_SUFFIX
}

function isManagedCloudRuntime(event: H3Event | null | undefined, config: Record<string, unknown>) {
  const profile = (envValue(event, [
    'HZY_DEPLOYMENT_PROFILE',
    'NUXT_PUBLIC_DEPLOYMENT_PROFILE'
  ]) || configValue(config, [
    'hzy.deploymentProfile',
    'public.deploymentProfile'
  ])).toLowerCase()

  return profile.startsWith('managed-cloud') || envValue(event, ['HZY_CLOUDFLARE_BUILD']) === 'true'
}

function configuredServiceBaseUrl(event: H3Event | null | undefined, appCode: string, config: Record<string, unknown>) {
  const envPart = appEnvPart(appCode)
  return normalizeBaseUrl(envValue(event, [
    `HZY_${envPart}_SERVICE_BASE_URL`,
    `HZY_${envPart}_SERVICE_URL`,
    `HZY_${envPart}_API_URL`,
    `HZY_${envPart}_ORIGIN`,
    `HZY_${envPart}_BASE_URL`
  ]) || configValue(config, [
    `hzy.serviceApps.${appCode}.baseUrl`,
    `serviceApps.${appCode}.baseUrl`
  ]))
}

function localServiceBaseUrl(appCode: string, basePath: string) {
  const port = LOCAL_APP_PORTS[appCode]
  if (!port) return ''
  return appendBasePath(`http://localhost:${port}`, basePath)
}

function trustedTenantGatewayServiceBaseUrl(
  event: H3Event | null | undefined,
  config: Record<string, unknown>,
  basePath: string
) {
  if (!event) return ''
  const context = resolveTrustedTenantGatewayContext(event, config)
  if (!context?.forwardedHost) return ''
  try {
    const url = new URL(`https://${context.forwardedHost}`)
    const suffix = managedDomainSuffix(event, config).toLowerCase()
    const hostname = url.hostname.toLowerCase()
    if (!suffix || !hostname.endsWith(`.${suffix}`) || hostname === suffix) return ''
    return appendBasePath(`https://${hostname}`, basePath)
  } catch {
    return ''
  }
}

export function resolveServiceAppBaseUrl(event: H3Event | null | undefined, appCodeInput: string, options: {
  basePath?: string
  directTarget?: boolean
} = {}) {
  const appCode = normalizeAppCode(appCodeInput)
  if (!appCode) return ''

  const config = useRuntimeConfig(event || undefined) as unknown as Record<string, unknown>
  const basePath = normalizeBasePath(options.basePath, appCode)
  if (isManagedCloudRuntime(event, config)) {
    if (options.directTarget) {
      return resolveTrustedServiceAppRoute(event, appCode, { basePath: options.basePath })?.baseUrl || ''
    }
    const gateway = resolveTenantGatewayServiceAppBaseUrl(event, appCode, options)
    if (gateway) return gateway
  }
  const configured = configuredServiceBaseUrl(event, appCode, config)
  if (configured) return appendBasePath(configured, basePath)

  if (isManagedCloudRuntime(event, config)) {
    return appendBasePath(`https://${appCode}.${managedDomainSuffix(event, config)}`, basePath)
  }

  return localServiceBaseUrl(appCode, basePath)
}

export function resolveTrustedServiceAppRoute(
  event: H3Event | null | undefined,
  appCodeInput: string,
  options: { basePath?: string, config?: Record<string, unknown> } = {}
): TrustedServiceAppRoute | null {
  const appCode = normalizeAppCode(appCodeInput)
  if (!event || !appCode) return null
  const config = options.config ?? useRuntimeConfig(event) as unknown as Record<string, unknown>
  if (!resolveTrustedTenantGatewayContext(event, config)) return null

  const raw = stringValue(getHeader(event, 'x-hzy-service-routes'))
  if (!raw || raw.length > 16_384) return null
  try {
    const catalog = JSON.parse(raw) as Record<string, unknown>
    const candidate = catalog?.[appCode]
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
    const route = candidate as Record<string, unknown>
    const origin = normalizeRouteOrigin(route.origin)
    const deploymentCode = safeDeploymentCode(route.deploymentCode)
    const basePath = normalizeBasePath(options.basePath || route.basePath, appCode)
    if (!origin || !deploymentCode) return null
    return {
      appCode,
      origin,
      deploymentCode,
      basePath,
      baseUrl: appendBasePath(origin, basePath)
    }
  } catch {
    return null
  }
}

export function resolveTenantGatewayServiceAppBaseUrl(
  event: H3Event | null | undefined,
  appCodeInput: string,
  options: { basePath?: string } = {}
) {
  const appCode = normalizeAppCode(appCodeInput)
  if (!appCode || !event) return ''
  const config = useRuntimeConfig(event) as unknown as Record<string, unknown>
  const basePath = normalizeBasePath(options.basePath, appCode)
  return trustedTenantGatewayServiceBaseUrl(event, config, basePath)
}
