import { getHeader, type H3Event } from 'h3'
import {
  getCachedConsoleRuntimeConfig,
  getConsoleRuntimeConfig,
  resolveConsoleRuntimeBaseUrl,
  resolveConsoleRuntimeTokenUrl
} from './consoleRuntime'

type ServiceTokenResponse = {
  access_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
}

type ServiceTokenCacheEntry = {
  accessToken: string
  expiresAt: number
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

const serviceTokenCache = new Map<string, ServiceTokenCacheEntry>()

// 可注入的本地 service token 签发器。Console 是 token 签发方（持有 signing key），
// 无法 fetch 自己的 /oauth/token（CF Worker 不能自调，会 522），因此由 Console 模块
// 注册本地签发器在 worker 内部直接签发。业务应用不注册，照常走 HTTP token 请求。
type LocalServiceTokenIssuer = (input: {
  audience: string
  scope: string
  event?: H3Event | null
}) => Promise<string | null>

let localServiceTokenIssuer: LocalServiceTokenIssuer | null = null

export function setLocalServiceTokenIssuer(issuer: LocalServiceTokenIssuer | null) {
  localServiceTokenIssuer = issuer
}

function stringValue(value: unknown) {
  return String(value || '').trim()
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

    if (current !== undefined && current !== null && String(current).trim()) {
      return String(current).trim()
    }
  }

  return ''
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function normalizeTokenUrl(value: string) {
  const normalized = trimTrailingSlash(value)
  if (!normalized) return ''

  try {
    const url = new URL(normalized)
    const path = url.pathname.replace(/\/+$/, '')
    if (!path) {
      url.pathname = '/oauth/token'
      url.search = ''
      url.hash = ''
      return url.toString()
    }

    if (path === '/api/v1/console/auth/service-token' || path === '/api/v1/console/oauth/token') {
      url.pathname = '/oauth/token'
      url.search = ''
      url.hash = ''
      return url.toString()
    }

    return url.toString()
  } catch {
    return normalized
  }
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

function appEnvPart(appCode: string) {
  return appCode.replace(/[^a-z0-9]/gi, '_').toUpperCase()
}

function resolveAppCode(config: Record<string, unknown>, event?: H3Event | null) {
  return getConfigValue(config, [
    'hzy.appCode',
    'public.appCode',
    'public.appName'
  ]) || envValue(event, ['HZY_APP_CODE', 'APP_CODE'])
}

function serviceClientEnvNames(appCode: string, field: 'clientId' | 'clientSecret') {
  const envPart = appEnvPart(appCode)
  if (field === 'clientId') {
    return [
      `HZY_${envPart}_SERVICE_CLIENT_ID`,
      `HZY_SERVICE_CLIENT_${envPart}_CLIENT_ID`,
      `HZY_SERVICE_CLIENT_${envPart}_ID`,
      'HZY_SERVICE_CLIENT_ID'
    ]
  }
  return [
    `HZY_${envPart}_SERVICE_CLIENT_SECRET`,
    `HZY_SERVICE_CLIENT_${envPart}_SECRET`,
    `HZY_SERVICE_CLIENT_${envPart}_CLIENT_SECRET`,
    'HZY_SERVICE_CLIENT_SECRET'
  ]
}

function resolveConsoleIssuer(config: Record<string, unknown>, event?: H3Event | null) {
  return trimTrailingSlash(envValue(event, ['HZY_CONSOLE_ISSUER', 'HZY_CONSOLE_URL', 'HZY_CONSOLE_API_URL']) || getConfigValue(config, [
    'hzy.serviceClient.issuer',
    'hzy.consoleOidc.issuer',
    'consoleOidc.issuer',
    'hzy.consoleUrl',
    'public.consoleUrl',
    'hzy.directory.consoleApiUrl'
  ]) || resolveConsoleRuntimeBaseUrl(config, event))
}

function resolveTokenUrl(
  config: Record<string, unknown>,
  eventRuntimeTokenUrl?: string | null,
  event?: H3Event | null
) {
  const cachedRuntimeTokenUrl = getCachedConsoleRuntimeConfig()?.console.tokenUrl
  const configured = envValue(event, ['HZY_CONSOLE_TOKEN_URL']) || getConfigValue(config, [
    'hzy.serviceClient.tokenUrl',
    'hzy.consoleOidc.tokenUrl',
    'consoleOidc.tokenUrl'
  ])
  if (configured) return normalizeTokenUrl(configured)

  const issuer = resolveConsoleIssuer(config, event)
  if (issuer) return normalizeTokenUrl(`${issuer}/oauth/token`)

  return normalizeTokenUrl(resolveConsoleRuntimeTokenUrl(config, event) || eventRuntimeTokenUrl || cachedRuntimeTokenUrl || '')
}

function forwardedServiceTokenHeaders(event?: H3Event | null) {
  if (!event) return {}

  const headers: Record<string, string> = {}
  for (const name of [
    'x-hzy-gateway',
    'x-hzy-gateway-token',
    'x-hzy-tenant',
    'x-hzy-deployment',
    'x-hzy-environment',
    'x-hzy-app-code',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-prefix',
    'x-forwarded-proto'
  ]) {
    const value = stringValue(getHeader(event, name))
    if (value) headers[name] = value
  }
  return headers
}

function hasRuntimeAppIdentity(event?: H3Event | null) {
  if (!event) return false
  return Boolean(
    stringValue(getHeader(event, 'x-hzy-gateway')) === 'tenant-gateway'
    && stringValue(getHeader(event, 'x-hzy-gateway-token'))
    && stringValue(getHeader(event, 'x-hzy-app-code'))
  )
}

function safeUrlHost(value: string) {
  try {
    const url = new URL(value)
    return url.host
  } catch {
    return ''
  }
}

function safeUrlPath(value: string) {
  try {
    const url = new URL(value)
    return url.pathname || '/'
  } catch {
    return ''
  }
}

function responseStatusCode(error: unknown) {
  const err = error as {
    statusCode?: number
    status?: number
    response?: {
      status?: number
    }
  }
  return Number(err?.statusCode || err?.status || err?.response?.status || 0) || 502
}

function responseMessage(error: unknown) {
  const err = error as {
    message?: string
    statusMessage?: string
    data?: {
      message?: string
      statusMessage?: string
      error?: string
    }
  }
  return stringValue(err?.data?.message || err?.data?.statusMessage || err?.data?.error || err?.statusMessage || err?.message)
}

export async function requestServiceAccessToken(input: {
  audience: string
  scope: string
  forceRefresh?: boolean
  event?: H3Event | null
}) {
  // Console 自身：在 worker 内部直接签发，避免 self-fetch 自己的 /oauth/token（522）。
  if (localServiceTokenIssuer) {
    const localToken = await localServiceTokenIssuer({
      audience: input.audience,
      scope: input.scope,
      event: input.event
    }).catch((error) => {
      console.warn('[serviceOidc] local issuer failed, falling back to HTTP token request:', error instanceof Error ? error.message : String(error))
      return null
    })
    if (localToken) return localToken
  }

  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const runtime = input.event
    ? await getConsoleRuntimeConfig({ event: input.event }).catch(() => null)
    : null
  const tokenUrl = resolveTokenUrl(config, runtime?.console.tokenUrl, input.event)
  const appCode = resolveAppCode(config, input.event)
  const clientId = getConfigValue(config, [
    'hzy.serviceClient.clientId',
    'serviceClient.clientId'
  ]) || envValue(input.event, serviceClientEnvNames(appCode, 'clientId')) || (appCode ? `${appCode}.runtime` : '')
  const clientSecret = getConfigValue(config, [
    'hzy.serviceClient.clientSecret',
    'serviceClient.clientSecret'
  ]) || envValue(input.event, serviceClientEnvNames(appCode, 'clientSecret'))
  const runtimeAppIdentity = !clientSecret && hasRuntimeAppIdentity(input.event)

  if (!tokenUrl || !clientId || (!clientSecret && !runtimeAppIdentity)) {
    throw createError({
      statusCode: 503,
      message: [
        'Console service client is not configured.',
        'Set HZY_SERVICE_CLIENT_ID, HZY_SERVICE_CLIENT_SECRET, and HZY_CONSOLE_TOKEN_URL,',
        'or enable Console runtime app identity before calling cross-module service APIs.'
      ].join(' ')
    })
  }

  const cacheKey = `${tokenUrl}|${clientId}|${input.audience}|${input.scope}`
  const cached = serviceTokenCache.get(cacheKey)
  if (!input.forceRefresh && cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.accessToken
  }

  let response: ServiceTokenResponse
  try {
    response = await $fetch<ServiceTokenResponse>(tokenUrl, {
      method: 'POST',
      headers: forwardedServiceTokenHeaders(input.event),
      body: {
        grant_type: 'client_credentials',
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : { app_code: appCode }),
        audience: input.audience,
        scope: input.scope
      },
      timeout: 10000
    })
  } catch (error: unknown) {
    const statusCode = responseStatusCode(error)
    const message = responseMessage(error) || 'Console service token request failed'
    console.error('[serviceOidc] Console service token request failed:', {
      statusCode,
      tokenHost: safeUrlHost(tokenUrl),
      tokenPath: safeUrlPath(tokenUrl),
      appCode,
      audience: input.audience,
      scope: input.scope,
      message,
      hasClientSecret: Boolean(clientSecret),
      hasRuntimeAppIdentity: runtimeAppIdentity,
      hasGatewayToken: Boolean(stringValue(input.event ? getHeader(input.event, 'x-hzy-gateway-token') : ''))
    })
    throw createError({ statusCode, message: `Console service token request failed: ${message}` })
  }

  const accessToken = stringValue(response.access_token)
  if (!accessToken || String(response.token_type || '').toLowerCase() !== 'bearer') {
    throw createError({ statusCode: 502, message: 'Console did not return a Bearer access token' })
  }

  const expiresIn = Number(response.expires_in || 900)
  serviceTokenCache.set(cacheKey, {
    accessToken,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000
  })

  return accessToken
}
