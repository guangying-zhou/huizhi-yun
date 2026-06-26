import type { RowDataPacket } from 'mysql2/promise'
import { queryRows } from '~~/server/utils/db'

export const DEFAULT_TENANT_RESERVED_SUBDOMAINS = [
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
  'workflow',
  'www'
]

interface ReservedSubdomainRow extends RowDataPacket {
  subdomain: string
}

export const DEFAULT_DEPLOYMENT_ENVIRONMENT = 'prod'

export type DeploymentEnvironment = string

function isMissingTableError(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'ER_NO_SUCH_TABLE'
}

function recordValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function envReservedTenantSubdomains() {
  return String(process.env.HZY_TENANT_RESERVED_SUBDOMAINS || '')
    .split(',')
    .map(item => normalizeTenantSubdomain(item))
    .filter(Boolean)
}

export async function tenantReservedSubdomainSet() {
  const reserved = new Set([
    ...DEFAULT_TENANT_RESERVED_SUBDOMAINS,
    ...envReservedTenantSubdomains()
  ])

  try {
    const rows = await queryRows<ReservedSubdomainRow[]>(
      `SELECT subdomain
       FROM tenant_reserved_subdomains
       WHERE status = 'active'`
    )

    for (const row of rows) {
      const subdomain = normalizeTenantSubdomain(row.subdomain)
      if (subdomain) reserved.add(subdomain)
    }
  } catch (error) {
    if (!isMissingTableError(error)) {
      throw error
    }
  }

  return reserved
}

export function parseTenantSettings(value: unknown) {
  if (!value) return {}

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return {}
    }
  }

  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function normalizeDeploymentEnvironment(value: unknown, fallback = DEFAULT_DEPLOYMENT_ENVIRONMENT): DeploymentEnvironment {
  const normalized = String(value || fallback || DEFAULT_DEPLOYMENT_ENVIRONMENT).trim().toLowerCase()
  if (/^[a-z0-9][a-z0-9_-]{0,31}$/.test(normalized)) {
    return normalized
  }

  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    message: 'environment may only contain lowercase letters, numbers, hyphens, and underscores'
  })
}

function mergeScopedSettings(base: Record<string, unknown>, override: Record<string, unknown>) {
  const next = { ...base, ...override }

  for (const key of ['tenantGateway', 'dataRuntime', 'platform'] as const) {
    next[key] = {
      ...recordValue(base[key]),
      ...recordValue(override[key])
    }
  }

  next.consoleLogin = mergeConsoleLoginSettings(base.consoleLogin, override.consoleLogin)

  return next
}

function mergeConsoleLoginSettings(baseValue: unknown, overrideValue: unknown) {
  const baseLogin = recordValue(baseValue)
  const overrideLogin = recordValue(overrideValue)

  return {
    ...baseLogin,
    ...overrideLogin,
    oidc: {
      ...recordValue(baseLogin.oidc),
      ...recordValue(overrideLogin.oidc)
    },
    cas: {
      ...recordValue(baseLogin.cas),
      ...recordValue(overrideLogin.cas)
    },
    wecom: {
      ...recordValue(baseLogin.wecom),
      ...recordValue(overrideLogin.wecom)
    }
  }
}

export function deploymentEnvironmentSettings(settings: Record<string, unknown>, environment?: unknown) {
  const env = normalizeDeploymentEnvironment(environment)
  const environments = recordValue(settings.deploymentEnvironments)
  const scoped = recordValue(environments[env])
  return env === DEFAULT_DEPLOYMENT_ENVIRONMENT
    ? mergeScopedSettings(settings, scoped)
    : scoped
}

function consoleLoginEnvironmentSettings(settings: Record<string, unknown>, environment?: unknown) {
  const env = normalizeDeploymentEnvironment(environment)
  if (env === DEFAULT_DEPLOYMENT_ENVIRONMENT) {
    return deploymentEnvironmentSettings(settings, env)
  }

  const environments = recordValue(settings.deploymentEnvironments)
  const prodScoped = recordValue(environments[DEFAULT_DEPLOYMENT_ENVIRONMENT])
  const base = mergeScopedSettings(settings, prodScoped)
  const scoped = recordValue(environments[env])

  return {
    consoleLogin: mergeConsoleLoginSettings(base.consoleLogin, scoped.consoleLogin)
  }
}

export function tenantDomainSuffix() {
  const runtimeConfig = useRuntimeConfig() as unknown as Record<string, unknown>
  const hzy = runtimeConfig.hzy && typeof runtimeConfig.hzy === 'object'
    ? runtimeConfig.hzy as Record<string, unknown>
    : {}

  return String(
    hzy.tenantDomainSuffix
    || process.env.HZY_TENANT_DOMAIN_SUFFIX
    || 'huizhi.yun'
  ).trim().replace(/^\.+|\.+$/g, '').toLowerCase()
}

export function normalizeTenantSubdomain(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/\..*$/, '')
}

export async function validateTenantSubdomain(value: unknown) {
  const subdomain = normalizeTenantSubdomain(value)

  if (!subdomain) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenantSubdomain is required'
    })
  }

  if (subdomain.length < 3 || subdomain.length > 63) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenantSubdomain length must be between 3 and 63'
    })
  }

  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(subdomain)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenantSubdomain may only contain lowercase letters, numbers, and hyphens'
    })
  }

  const reservedSubdomains = await tenantReservedSubdomainSet()
  if (reservedSubdomains.has(subdomain)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `tenantSubdomain is reserved: ${subdomain}`
    })
  }

  return subdomain
}

export function tenantHost(subdomain: string, suffix = tenantDomainSuffix()) {
  return `${subdomain}.${suffix}`
}

export function tenantPublicUrl(subdomain: string, suffix = tenantDomainSuffix()) {
  return `https://${tenantHost(subdomain, suffix)}`
}

export function hostFromUrl(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function subdomainFromHost(host: string, suffix = tenantDomainSuffix()) {
  const normalizedHost = hostFromUrl(host)
  const normalizedSuffix = suffix.replace(/^\.+|\.+$/g, '').toLowerCase()
  const suffixWithDot = `.${normalizedSuffix}`

  return normalizedHost.endsWith(suffixWithDot)
    ? normalizedHost.slice(0, -suffixWithDot.length)
    : ''
}

export function normalizeDataRuntimeEndpoint(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) return null

  return normalizeHttpUrl(raw, 'defaultDataRuntimeEndpoint')
}

export function normalizeHttpUrl(value: unknown, fieldName: string) {
  const raw = String(value || '').trim()
  if (!raw) return null

  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol')
    }
    url.pathname = url.pathname.replace(/\/+$/, '')
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${fieldName} must be an absolute http(s) URL`
    })
  }
}

export function dataRuntimeSettings(settings: Record<string, unknown>, environment?: unknown) {
  const scoped = deploymentEnvironmentSettings(settings, environment)
  const dataRuntime = recordValue(scoped.dataRuntime)

  return {
    defaultEndpoint: normalizeDataRuntimeEndpoint(dataRuntime.defaultEndpoint)
  }
}

export function tenantGatewaySettings(settings: Record<string, unknown>, environment?: unknown) {
  const scoped = deploymentEnvironmentSettings(settings, environment)
  const tenantGateway = recordValue(scoped.tenantGateway)

  return {
    subdomain: normalizeTenantSubdomain(tenantGateway.subdomain)
  }
}

export function platformEnvironmentSettings(settings: Record<string, unknown>, environment?: unknown) {
  const scoped = deploymentEnvironmentSettings(settings, environment)
  const platform = recordValue(scoped.platform)
  const baseUrl = normalizeHttpUrl(platform.baseUrl, 'platformBaseUrl')

  return {
    baseUrl
  }
}

export type ConsoleLoginMode = 'none' | 'oidc' | 'cas' | 'wecom'

export function normalizeConsoleLoginMode(value: unknown): ConsoleLoginMode {
  const mode = String(value || '').trim().toLowerCase()
  if (mode === 'oidc' || mode === 'cas' || mode === 'wecom') return mode
  return 'none'
}

export function consoleLoginSettings(settings: Record<string, unknown>, environment?: unknown) {
  const scoped = consoleLoginEnvironmentSettings(settings, environment)
  const login = recordValue(scoped.consoleLogin)
  const oidc = recordValue(login.oidc)
  const cas = recordValue(login.cas)
  const wecom = recordValue(login.wecom)

  return {
    mode: normalizeConsoleLoginMode(login.mode),
    oidc: {
      providerCode: String(oidc.providerCode || 'sso_oidc').trim() || 'sso_oidc',
      issuer: String(oidc.issuer || '').trim().replace(/\/+$/, ''),
      authorizationEndpoint: String(oidc.authorizationEndpoint || '').trim().replace(/\/+$/, ''),
      tokenEndpoint: String(oidc.tokenEndpoint || '').trim().replace(/\/+$/, ''),
      userinfoEndpoint: String(oidc.userinfoEndpoint || '').trim().replace(/\/+$/, ''),
      endSessionEndpoint: String(oidc.endSessionEndpoint || '').trim().replace(/\/+$/, ''),
      jwksUri: String(oidc.jwksUri || '').trim().replace(/\/+$/, ''),
      clientId: String(oidc.clientId || '').trim(),
      clientSecret: String(oidc.clientSecret || '').trim(),
      scope: String(oidc.scope || 'openid profile email').trim() || 'openid profile email'
    },
    cas: {
      baseUrl: String(cas.baseUrl || '').trim().replace(/\/+$/, '')
    },
    wecom: {
      corpid: String(wecom.corpid || '').trim(),
      agentid: String(wecom.agentid || '').trim(),
      corpsecret: String(wecom.corpsecret || '').trim()
    }
  }
}
