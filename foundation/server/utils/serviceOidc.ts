import { getHeader, type H3Event } from 'h3'
import {
  getCachedConsoleRuntimeConfig,
  getConsoleRuntimeConfig,
  resolveConsoleRuntimeBaseUrl,
  resolveConsoleRuntimeTokenUrl
} from './consoleRuntime'
import {
  consoleServiceBinding,
  normalizeConsoleServiceBindingUrl
} from './consoleServiceBinding'
import { resolveTrustedTenantGatewayContext } from './tenantGatewayTrust'
import { resolveTrustedServiceAppRoute } from './serviceAppUrl'
import { executeServiceTokenRequest } from './serviceTokenRequest'

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
type ConsoleServiceJsonInit = Omit<RequestInit, 'body'> & {
  body?: unknown
  timeout?: number
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

const serviceTokenCache = new Map<string, ServiceTokenCacheEntry>()
const serviceTokenFlights = new Map<string, Promise<string>>()

// 可注入的本地 service token 签发器。Console 是 token 签发方（持有 signing key），
// 无法 fetch 自己的 /oauth/token（CF Worker 不能自调，会 522），因此由 Console 模块
// 注册本地签发器在 worker 内部直接签发。业务应用不注册，照常走 HTTP token 请求。
type LocalServiceTokenIssuer = (input: {
  audience: string
  scope: string
  deploymentCodeOverride?: string | null
  sourceBinding?: 'trusted-gateway' | 'service-client-policy'
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

export function hasConsoleServiceBinding(event?: H3Event | null) {
  return Boolean(consoleServiceBinding(event))
}

export async function fetchConsoleServiceJson<T>(
  event: H3Event | null | undefined,
  input: string | URL,
  init: ConsoleServiceJsonInit = {}
): Promise<T> {
  const { body, timeout, ...requestInit } = init
  const headers = new Headers(requestInit.headers)
  if (body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const signal = requestInit.signal
    || (timeout && typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeout) : undefined)
  const normalizedInit: RequestInit = {
    ...requestInit,
    headers,
    signal,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
  }
  const binding = consoleServiceBinding(event)
  const response = binding
    ? await binding.fetch(normalizeConsoleServiceBindingUrl(input), normalizedInit)
    : await fetch(input, normalizedInit)
  const payload = await response.json().catch(() => ({})) as T
  if (!response.ok) {
    const errorPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {}
    const error = new Error(
      stringValue(errorPayload.message || errorPayload.statusMessage || errorPayload.error)
      || response.statusText
      || 'Console service request failed'
    ) as Error & { statusCode?: number, data?: Record<string, unknown> }
    error.statusCode = response.status
    error.data = errorPayload
    throw error
  }
  return payload
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

function resolveTrustedTenantGatewayTokenUrl(
  config: Record<string, unknown>,
  event?: H3Event | null
) {
  if (!event) return ''
  const context = resolveTrustedTenantGatewayContext(event, config)
  const forwardedHost = stringValue(context?.forwardedHost).toLowerCase()
  if (!forwardedHost) return ''

  try {
    const url = new URL(`https://${forwardedHost}`)
    if (url.host.toLowerCase() !== forwardedHost) return ''
    url.pathname = '/oauth/token'
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

function resolveTokenUrl(
  config: Record<string, unknown>,
  eventRuntimeTokenUrl?: string | null,
  event?: H3Event | null
) {
  const cachedRuntimeTokenUrl = getCachedConsoleRuntimeConfig(event, config)?.console.tokenUrl
  const configured = envValue(event, ['HZY_CONSOLE_TOKEN_URL']) || getConfigValue(config, [
    'hzy.serviceClient.tokenUrl',
    'hzy.consoleOidc.tokenUrl',
    'consoleOidc.tokenUrl'
  ])
  if (configured) return normalizeTokenUrl(configured)

  // Cloudflare business Workers must exchange their service identity through
  // the tenant Gateway host. Calling the shared Console Worker hostname from
  // another Worker can lose the tenant-host transport context before Console
  // verifies the trusted app binding. The host is accepted only from an exact
  // shared-token gateway context; browser-supplied forwarding headers cannot
  // select this route.
  const tenantGatewayTokenUrl = resolveTrustedTenantGatewayTokenUrl(config, event)
  if (tenantGatewayTokenUrl) return tenantGatewayTokenUrl

  const issuer = resolveConsoleIssuer(config, event)
  if (issuer) return normalizeTokenUrl(`${issuer}/oauth/token`)

  return normalizeTokenUrl(resolveConsoleRuntimeTokenUrl(config, event) || eventRuntimeTokenUrl || cachedRuntimeTokenUrl || '')
}

function forwardedTenantGatewayHeaders(
  event: H3Event | null | undefined,
  config: Record<string, unknown>,
  options: { includeRuntimeBootstrap?: boolean } = {}
) {
  if (!event || !resolveTrustedTenantGatewayContext(event, config)) return {}

  const headers: Record<string, string> = {}
  const names = [
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
  ]
  if (options.includeRuntimeBootstrap) {
    names.push(
      'x-hzy-data-runtime-url',
      'x-hzy-data-runtime-code',
      'x-hzy-data-runtime-token',
      'x-hzy-data-runtime-audience'
    )
  }
  for (const name of names) {
    const value = stringValue(getHeader(event, name))
    if (value) headers[name] = value
  }
  return headers
}

/**
 * Carries an already verified tenant-gateway binding to a downstream service
 * request. Untrusted browser headers are never forwarded.
 */
export function trustedServiceRequestHeaders(event: H3Event | null | undefined, targetAppCode?: string) {
  if (!event) return {}
  const config = useRuntimeConfig(event) as unknown as Record<string, unknown>
  const headers = forwardedTenantGatewayHeaders(event, config, {
    includeRuntimeBootstrap: true
  })
  if (!targetAppCode) return headers

  const target = resolveTrustedServiceAppRoute(event, targetAppCode)
  if (!target) return headers
  headers['x-hzy-app-code'] = target.appCode
  headers['x-hzy-deployment'] = target.deploymentCode
  headers['x-forwarded-prefix'] = target.basePath.replace(/\/+$/, '') || '/'
  return headers
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
  deploymentCodeOverride?: string | null
  forceRefresh?: boolean
  /**
   * `trusted-gateway` binds the token to the verified inbound gateway source.
   * A cross-app target BFF that needs its own runtime identity must explicitly
   * select `service-client-policy`; that mode binds the target app to its exact
   * runtime client (credential or trusted runtime app identity) and takes the
   * tenant from Console policy or the verified inbound Tenant Gateway context.
   */
  sourceBinding?: 'trusted-gateway' | 'service-client-policy'
  event?: H3Event | null
}) {
  // Console 自身：在 worker 内部直接签发，避免 self-fetch 自己的 /oauth/token（522）。
  if (localServiceTokenIssuer) {
    const localToken = await localServiceTokenIssuer({
      audience: input.audience,
      scope: input.scope,
      deploymentCodeOverride: input.deploymentCodeOverride,
      sourceBinding: input.sourceBinding,
      event: input.event
    })
    if (localToken) return localToken
  }

  const config = useRuntimeConfig(input.event || undefined) as unknown as Record<string, unknown>
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
  const sourceBinding = input.sourceBinding || 'trusted-gateway'
  const gatewayContext = input.event
    ? resolveTrustedTenantGatewayContext(input.event, config)
    : null
  // A verified Tenant Gateway app identity is authoritative during the
  // Console Runtime migration. Prefer it over any legacy Worker secret that
  // may still be configured, because the credential is tenant-owned now.
  const runtimeAppIdentity = Boolean(gatewayContext?.appCode && gatewayContext.appCode === appCode)

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

  const cacheKey = [
    tokenUrl,
    clientId,
    input.audience,
    input.scope,
    sourceBinding,
    gatewayContext?.tenant || 'unbound',
    gatewayContext?.deployment || 'unbound',
    gatewayContext?.environment || 'unbound',
    gatewayContext?.appCode || appCode || 'unbound'
  ].join('|')
  const cached = serviceTokenCache.get(cacheKey)
  if (!input.forceRefresh && cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.accessToken
  }
  if (input.forceRefresh) serviceTokenCache.delete(cacheKey)

  const inFlight = serviceTokenFlights.get(cacheKey)
  if (inFlight) return await inFlight

  const refresh = async () => {
    let response: ServiceTokenResponse
    const requestHeaders = gatewayContext
      ? forwardedTenantGatewayHeaders(input.event, config, {
          includeRuntimeBootstrap: true
        })
      : {}
    const requestBody = {
      grant_type: 'client_credentials',
      client_id: clientId,
      ...(runtimeAppIdentity ? { app_code: appCode } : { client_secret: clientSecret }),
      audience: input.audience,
      scope: input.scope,
      source_binding: sourceBinding
    }
    try {
      const serviceBinding = consoleServiceBinding(input.event)
      if (serviceBinding) {
        const boundResponse = await serviceBinding.fetch(normalizeConsoleServiceBindingUrl(tokenUrl), {
          method: 'POST',
          headers: {
            ...requestHeaders,
            'accept': 'application/json',
            'content-type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        })
        const payload = await boundResponse.json().catch(() => ({})) as Record<string, unknown>
        if (!boundResponse.ok) {
          const error = new Error(
            stringValue(payload.message || payload.statusMessage || payload.error)
            || boundResponse.statusText
            || 'Console service token request failed'
          ) as Error & { statusCode?: number, data?: Record<string, unknown> }
          error.statusCode = boundResponse.status
          error.data = payload
          throw error
        }
        response = payload as ServiceTokenResponse
      } else {
        type ServiceTokenFetch = (
          url: string,
          options: Record<string, unknown>
        ) => Promise<ServiceTokenResponse>
        const fetchServiceToken = $fetch as unknown as ServiceTokenFetch
        response = await fetchServiceToken(tokenUrl, {
          method: 'POST',
          headers: requestHeaders,
          body: requestBody,
          timeout: 10000
        })
      }
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

  const result = refresh().finally(() => {
    if (serviceTokenFlights.get(cacheKey) === result) serviceTokenFlights.delete(cacheKey)
  })
  serviceTokenFlights.set(cacheKey, result)
  return await result
}

export async function requestWithServiceAccessToken<T>(input: {
  audience: string
  scope: string
  event?: H3Event | null
  request: (token: string) => Promise<T>
}) {
  return await executeServiceTokenRequest({
    getToken: forceRefresh => requestServiceAccessToken({
      audience: input.audience,
      scope: input.scope,
      event: input.event,
      forceRefresh
    }),
    request: input.request,
    statusCode: responseStatusCode
  })
}
