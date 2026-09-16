import { createHash, randomBytes } from 'node:crypto'
import { createRemoteJWKSet, customFetch, decodeJwt, jwtVerify, type JWTPayload } from 'jose'
import {
  createError,
  deleteCookie,
  getCookie,
  getHeader,
  getQuery,
  getRequestURL,
  readBody,
  sendRedirect,
  setCookie,
  setHeader,
  type H3Event
} from 'h3'
import { getAuthCookieOptions } from './cookie-domain'
import { deriveOidcCallbackUrl, getRequestOrigin, resolveCurrentAppUrl } from './appUrls'
import { getCachedConsoleRuntimeConfig, resolveConsoleRuntimeBaseUrl, resolveTenantGatewayConsoleOrigin } from './consoleRuntime'
import { fetchExternal } from './externalFetch'
import { trustedServiceRequestHeaders } from './serviceOidc'
import { createRequestAuthMemo } from './requestAuthMemo'
import { measureRequestStage } from './performanceTiming'
import {
  consoleServiceBinding,
  consoleServiceFetch,
  normalizeConsoleServiceBindingUrl
} from './consoleServiceBinding'
import {
  createConsoleOidcTransientCookieNames,
  isConsoleOidcReauthenticationRequired
} from './consoleOidcFlow'

export type ConsoleOidcClaims = JWTPayload & {
  token_use?: string
  scope?: string
  tenant?: string
  deployment?: string
  policy_ver?: string
  caps?: string[]
  hzy?: {
    uid?: string
    subjectType?: string
    subjectCode?: string
    clientCode?: string
    appCode?: string
  }
}

export type ConsoleAuthRequestContext = {
  authenticated: boolean
  reason?: 'disabled' | 'missing_token' | 'invalid_token' | 'revoked_session' | 'revoked_service_token' | 'service_token_introspection_unavailable' | 'bypass'
  token?: string
  claims?: ConsoleOidcClaims
  tokenUse?: string
  subjectType?: string
  uid?: string
  subjectCode?: string
  clientCode?: string
  appCode?: string
  scopes?: string[]
  tenant?: string
  deployment?: string
  policyVersion?: string
}

type ConsoleOidcTokenResponse = {
  access_token?: string
  id_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  refresh_expires_in?: number
}

type ConsoleOidcConfig = {
  enabled: boolean
  legacyFallback: boolean
  issuer: string
  clientId: string
  redirectUri: string
  logoutRedirectUri: string
  scope: string
}

export type ConsoleServiceTokenIntrospectionFetch = (
  url: string,
  options: { method: 'POST', headers: Record<string, string>, body: string }
) => Promise<{ active?: boolean }>

type EventLocalFetch = <T>(
  request: string,
  options: { method: 'POST', headers: Record<string, string>, body: string }
) => Promise<T>

export function resolveConsoleServiceTokenIntrospectionFetcher(
  event: H3Event,
  endpointBaseUrl: string,
  currentAppCode = ''
): ConsoleServiceTokenIntrospectionFetch | undefined {
  const eventFetch = (event as unknown as { $fetch?: EventLocalFetch }).$fetch
  const isConsoleRuntime = currentAppCode.trim().toLowerCase() === 'console'
  if (isConsoleRuntime && eventFetch) {
    // A public HTTP request from the Console Worker back into its own custom
    // domain is a Cloudflare Worker loop and is terminated as HTTP 522.
    return async (url, options) => {
      const target = new URL(url)
      return eventFetch<{ active?: boolean }>(`${target.pathname}${target.search}`, options)
    }
  }

  const binding = consoleServiceBinding(event)
  if (binding) {
    // Managed-cloud application Workers must not introspect through Console's
    // public custom domain. Background Worker requests have no visitor country
    // context and can be rejected by the production geo WAF before Console is
    // reached. The binding retains Console as the authoritative verification
    // boundary while using Cloudflare's private Worker-to-Worker transport.
    return async (url, options) => {
      const response = await binding.fetch(normalizeConsoleServiceBindingUrl(url), options)
      const payload = await response.json().catch(() => ({})) as { active?: boolean, message?: unknown }
      if (!response.ok) {
        const error = new Error(String(payload.message || response.statusText || 'Console introspection failed')) as Error & {
          statusCode?: number
          data?: { active?: boolean, message?: unknown }
        }
        error.statusCode = response.status
        error.data = payload
        throw error
      }
      return payload
    }
  }

  if (!eventFetch) return undefined
  if (!isConsoleRuntime) {
    try {
      if (new URL(endpointBaseUrl).origin !== new URL(getRequestOrigin(event)).origin) {
        return undefined
      }
    } catch {
      return undefined
    }
  }

  // Same-origin non-Console deployments are uncommon, but can still dispatch
  // locally without crossing the public edge.
  return async (url, options) => {
    const target = new URL(url)
    return eventFetch<{ active?: boolean }>(`${target.pathname}${target.search}`, options)
  }
}

function serviceTokenIntrospectionFailureDiagnostics(error: unknown) {
  const candidate = error as {
    statusCode?: unknown
    status?: unknown
    message?: unknown
    data?: { code?: unknown, message?: unknown }
    response?: {
      status?: unknown
      statusCode?: unknown
      statusText?: unknown
      _data?: { code?: unknown, message?: unknown }
    }
  }
  const responseData = candidate?.response?._data || candidate?.data
  const safeText = (value: unknown) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)

  return {
    statusCode: Number(
      candidate?.statusCode
      || candidate?.status
      || candidate?.response?.statusCode
      || candidate?.response?.status
      || 0
    ),
    statusText: safeText(candidate?.response?.statusText),
    code: safeText(responseData?.code),
    summary: safeText(responseData?.message || candidate?.message)
  }
}

export async function requireActiveConsoleServiceToken(input: {
  endpointBaseUrl: string
  token: string
  headers?: Record<string, string>
  fetcher?: ConsoleServiceTokenIntrospectionFetch
}) {
  const fetcher = input.fetcher || (fetchExternal as unknown as ConsoleServiceTokenIntrospectionFetch)
  let response: { active?: boolean }
  try {
    response = await fetcher(`${trimTrailingSlash(input.endpointBaseUrl)}/oauth/introspect`, {
      method: 'POST',
      headers: {
        ...(input.headers || {}),
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ token: input.token }).toString()
    })
  } catch (error) {
    console.warn(
      '[console-auth] service token introspection request failed',
      serviceTokenIntrospectionFailureDiagnostics(error)
    )
    throw createError({
      statusCode: 503,
      statusMessage: 'Service token introspection unavailable',
      message: 'service_token_introspection_unavailable'
    })
  }
  if (response.active !== true) {
    throw createError({ statusCode: 401, message: 'invalid_token: service credential or grant revoked' })
  }
}

export const consoleOidcCookies = {
  accessToken: 'hzy_access_token',
  idToken: 'hzy_id_token',
  refreshToken: 'hzy_refresh_token',
  uid: 'hzy_uid',
  tenant: 'hzy_tenant',
  subjectCode: 'hzy_subject_code',
  policyVersion: 'hzy_policy_ver'
} as const

const transientCookies = {
  state: 'hzy_oidc_state',
  nonce: 'hzy_oidc_nonce',
  codeVerifier: 'hzy_oidc_code_verifier',
  redirect: 'hzy_oidc_redirect'
} as const

function cookieScope(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'app'
}

function scopedCookieName(scope: string, suffix: string) {
  return `hzy_${cookieScope(scope)}_${suffix}`
}

function getConsoleOidcCookieNames(event: H3Event) {
  const scope = resolveCookieScope(event)
  return {
    accessToken: scopedCookieName(scope, 'access_token'),
    idToken: scopedCookieName(scope, 'id_token'),
    refreshToken: scopedCookieName(scope, 'refresh_token'),
    uid: scopedCookieName(scope, 'uid'),
    tenant: scopedCookieName(scope, 'tenant'),
    subjectCode: scopedCookieName(scope, 'subject_code'),
    policyVersion: scopedCookieName(scope, 'policy_ver')
  } as const
}

function getConsoleOidcRefreshToken(event: H3Event) {
  const cookieNames = getConsoleOidcCookieNames(event)
  return String(
    getCookie(event, cookieNames.refreshToken)
    || getCookie(event, consoleOidcCookies.refreshToken)
    || ''
  ).trim()
}

export function hasConsoleOidcRefreshToken(event: H3Event) {
  return Boolean(getConsoleOidcRefreshToken(event))
}

function getTransientCookieNames(event: H3Event, authorizationState?: string) {
  const scope = resolveCookieScope(event)
  return createConsoleOidcTransientCookieNames(scope, authorizationState)
}

type IssuerJwksCacheEntry = {
  headerState: {
    value: Record<string, string>
  }
  resolver: ReturnType<typeof createRemoteJWKSet>
}

const jwksByIssuer = new Map<string, IssuerJwksCacheEntry>()
const consoleBackendHeaderNames = [
  'x-hzy-gateway',
  'x-hzy-gateway-token',
  'x-hzy-tenant',
  'x-hzy-deployment',
  'x-hzy-environment',
  'x-hzy-app-code',
  'x-hzy-data-runtime-url',
  'x-hzy-data-runtime-code',
  'x-hzy-data-runtime-token',
  'x-hzy-data-runtime-audience',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-prefix',
  'x-forwarded-proto'
] as const

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function addIssuerCandidate(candidates: Set<string>, value: unknown) {
  const issuer = trimTrailingSlash(String(value || '').trim())
  if (!issuer) return

  candidates.add(issuer)
  try {
    const url = new URL(issuer)
    candidates.add(url.origin)
  } catch {
    // Keep non-URL issuer values as-is.
  }
}

function safeUrlHost(value: string) {
  try {
    return new URL(value).host
  } catch {
    return ''
  }
}

function getConfigValue(event: H3Event, keys: string[]) {
  const config = useRuntimeConfig(event) as unknown as Record<string, unknown>

  for (const key of keys) {
    const parts = key.split('.')
    let current: unknown = config
    for (const part of parts) {
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

function resolveConsoleOidcEndpointBaseUrl(event: H3Event, config: ConsoleOidcConfig) {
  const configured = getConfigValue(event, [
    'hzy.consoleOidc.endpointBaseUrl',
    'consoleOidc.endpointBaseUrl',
    'hzy.consoleOidc.apiUrl',
    'consoleOidc.apiUrl'
  ])
  const runtimeConfigured = getConfigValue(event, [
    'hzy.consoleRuntime.consoleApiUrl',
    'hzy.runtime.consoleApiUrl',
    'hzy.directory.consoleApiUrl',
    'hzy.integration.consoleApiUrl',
    'hzy.consoleApiUrl'
  ])
  const internalRuntimeUrl = process.env.HZY_CONSOLE_OIDC_API_URL
    || process.env.HZY_CONSOLE_RUNTIME_API_URL
    || ''
  const cachedRuntimeBaseUrl = String(getCachedConsoleRuntimeConfig(event, useRuntimeConfig(event) as unknown as Record<string, unknown>)?.console.baseUrl || '').trim()

  return trimTrailingSlash(
    configured
    || internalRuntimeUrl
    || runtimeConfigured
    || cachedRuntimeBaseUrl
    || resolveConsoleRuntimeBaseUrl(useRuntimeConfig(event) as unknown as Record<string, unknown>, event)
    || config.issuer
  )
}

function consoleBackendRequestHeaders(event: H3Event, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra }
  for (const name of consoleBackendHeaderNames) {
    const value = String(getHeader(event, name) || '').trim()
    if (value) headers[name] = value
  }

  try {
    const requestOrigin = new URL(getRequestOrigin(event))
    if (!headers['x-forwarded-host'] && requestOrigin.host) {
      headers['x-forwarded-host'] = requestOrigin.host
    }
    if (!headers['x-forwarded-proto'] && requestOrigin.protocol) {
      headers['x-forwarded-proto'] = requestOrigin.protocol.replace(/:$/, '')
    }
  } catch {
    // getRequestOrigin already has conservative fallbacks; ignore malformed input.
  }

  return headers
}

function resolveRedirectUri(event: H3Event) {
  const configured = getConfigValue(event, [
    'hzy.consoleOidc.redirectUri',
    'consoleOidc.redirectUri'
  ])
  if (configured) {
    return configured
  }

  return deriveOidcCallbackUrl(event)
}

function resolveLogoutRedirectUri(event: H3Event) {
  const configured = getConfigValue(event, [
    'hzy.consoleOidc.logoutRedirectUri',
    'consoleOidc.logoutRedirectUri'
  ])
  if (configured) {
    return configured
  }

  return ''
}

function resolveIssuer(event: H3Event) {
  const config = useRuntimeConfig(event) as unknown as Record<string, unknown>
  const tenantGatewayIssuer = resolveTenantGatewayConsoleOrigin(event)
  if (tenantGatewayIssuer) {
    return trimTrailingSlash(tenantGatewayIssuer)
  }

  const runtimeIssuer = String(getCachedConsoleRuntimeConfig(event, config)?.console.issuer || '').trim()
  if (runtimeIssuer) {
    return trimTrailingSlash(runtimeIssuer)
  }

  const configured = getConfigValue(event, [
    'hzy.consoleOidc.issuer',
    'consoleOidc.issuer',
    'public.consoleUrl',
    'hzy.directory.consoleApiUrl'
  ]) || resolveConsoleRuntimeBaseUrl(config, event) || ''
  if (configured) {
    return trimTrailingSlash(configured)
  }

  const deploymentPublicUrl = getConfigValue(event, [
    'public.deploymentPublicUrl',
    'hzy.deploymentPublicUrl'
  ])
  return deploymentPublicUrl ? trimTrailingSlash(deploymentPublicUrl) : ''
}

function resolveClientId(event: H3Event) {
  const configured = getConfigValue(event, [
    'hzy.consoleOidc.clientId',
    'consoleOidc.clientId',
    'public.appCode',
    'public.appName'
  ])
  return configured || 'app'
}

function resolveCookieScope(event: H3Event) {
  const configured = getConfigValue(event, [
    'public.appCode',
    'public.appName',
    'hzy.consoleOidc.clientId',
    'consoleOidc.clientId'
  ])
  return configured || 'app'
}

export function getConsoleOidcConfig(event: H3Event): ConsoleOidcConfig {
  const issuer = resolveIssuer(event)
  const authMode = getConfigValue(event, [
    'hzy.authMode',
    'authMode',
    'public.authMode'
  ]) || process.env.HZY_AUTH_MODE || ''
  const legacyFallback = String(process.env.HZY_LEGACY_AUTH_BRIDGE || '').toLowerCase() === 'true'
    || authMode === 'legacy'
  const enabled = !legacyFallback && Boolean(issuer)

  return {
    enabled,
    legacyFallback,
    issuer,
    clientId: resolveClientId(event),
    redirectUri: resolveRedirectUri(event),
    logoutRedirectUri: resolveLogoutRedirectUri(event),
    scope: getConfigValue(event, [
      'hzy.consoleOidc.scope',
      'consoleOidc.scope'
    ]) || 'openid offline_access'
  }
}

export function isConsoleOidcEnabled(event: H3Event) {
  return getConsoleOidcConfig(event).enabled
}

export function shouldUseLegacyAuthBridge(event: H3Event) {
  return !isConsoleOidcEnabled(event)
}

function randomToken(byteLength = 32) {
  return randomBytes(byteLength).toString('base64url')
}

function createPkceChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url')
}

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function firstQueryValue(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }

  return typeof value === 'string' ? value : ''
}

function getTokenMaxAge(seconds: unknown, fallbackSeconds: number) {
  const parsed = Number(seconds)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallbackSeconds
}

function getConsoleOidcTransientMaxAge(event: H3Event) {
  const configured = getConfigValue(event, [
    'hzy.consoleOidc.transientTtlSeconds',
    'consoleOidc.transientTtlSeconds'
  ]) || process.env.HZY_CONSOLE_OIDC_TRANSIENT_TTL_SECONDS || ''

  return getTokenMaxAge(configured, 1800)
}

function setNoStoreHeaders(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  setHeader(event, 'Pragma', 'no-cache')
  setHeader(event, 'Expires', '0')
}

function getCookieBaseOptions(event: H3Event, maxAge?: number, httpOnly = false) {
  return getAuthCookieOptions(event, {
    ...(maxAge ? { maxAge } : {}),
    httpOnly,
    secure: getRequestURL(event).protocol === 'https:'
  })
}

function setNullableCookie(event: H3Event, name: string, value: string | undefined | null, maxAge: number) {
  if (!value) {
    deleteCookie(event, name, getCookieBaseOptions(event))
    return
  }

  setCookie(event, name, value, getCookieBaseOptions(event, maxAge))
}

export function clearConsoleOidcCookies(event: H3Event, options: { preserveRefreshToken?: boolean } = {}) {
  const oidcCookieNames = getConsoleOidcCookieNames(event)
  const refreshTokenNames = new Set([
    oidcCookieNames.refreshToken,
    consoleOidcCookies.refreshToken
  ])
  const names = [
    ...Object.values(oidcCookieNames),
    ...Object.values(getTransientCookieNames(event)),
    ...Object.values(consoleOidcCookies),
    ...Object.values(transientCookies)
  ]
  const cookieOptions = getCookieBaseOptions(event)

  for (const name of new Set(names)) {
    if (options.preserveRefreshToken && refreshTokenNames.has(name)) continue
    deleteCookie(event, name, cookieOptions)
  }
}

function isExpiredJwt(token: string) {
  try {
    const claims = decodeJwt(token)
    return typeof claims.exp === 'number' && claims.exp <= Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

function sanitizeOidcRedirect(event: H3Event, raw: unknown) {
  if (typeof raw !== 'string') {
    return '/'
  }

  const value = raw.trim()
  if (!value) {
    return '/'
  }

  if (value.startsWith('/') && !value.startsWith('//')) {
    return value
  }

  try {
    const target = new URL(value)
    const current = new URL(getRequestOrigin(event))
    const sharedDomain = getAuthCookieOptions(event).domain?.replace(/^\./, '')
    const isLocal = (hostname: string) => hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)

    if (!['http:', 'https:'].includes(target.protocol)) {
      return '/'
    }

    if (target.hostname === current.hostname) {
      return target.toString()
    }

    if (sharedDomain && target.hostname.endsWith(sharedDomain)) {
      return target.toString()
    }

    if (isLocal(target.hostname) && isLocal(current.hostname)) {
      return target.toString()
    }
  } catch {
    return '/'
  }

  return '/'
}

function toAbsoluteAppRedirect(event: H3Event, redirect: string) {
  if (redirect.startsWith('/') && !redirect.startsWith('//')) {
    return resolveCurrentAppUrl(event, redirect)
  }

  return redirect
}

function appendLoggedOutState(redirect: string, state: string) {
  const isRelative = redirect.startsWith('/') && !redirect.startsWith('//')
  const target = new URL(redirect, isRelative ? 'http://localhost' : undefined)
  target.searchParams.set('logged_out', '1')
  if (state) {
    target.searchParams.set('state', state)
  }

  return isRelative ? `${target.pathname}${target.search}${target.hash}` : target.toString()
}

function getAuthorizeUrl(config: ConsoleOidcConfig, state: string, nonce: string, challenge: string) {
  const url = new URL(`${config.issuer}/oauth/authorize`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('scope', config.scope)
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export async function startConsoleOidcLogin(event: H3Event) {
  const config = getConsoleOidcConfig(event)
  if (!config.enabled) {
    throw createError({ statusCode: 500, message: 'Console OIDC is not configured' })
  }
  setNoStoreHeaders(event)

  const query = getQuery(event)
  const redirect = sanitizeOidcRedirect(event, firstQueryValue(query.redirect))
  const state = randomToken()
  const nonce = randomToken()
  const verifier = randomToken(48)
  const challenge = createPkceChallenge(verifier)
  const transientOptions = getCookieBaseOptions(event, getConsoleOidcTransientMaxAge(event), true)
  const transientCookieNames = getTransientCookieNames(event, state)

  setCookie(event, transientCookieNames.state, state, transientOptions)
  setCookie(event, transientCookieNames.nonce, nonce, transientOptions)
  setCookie(event, transientCookieNames.codeVerifier, verifier, transientOptions)
  setCookie(event, transientCookieNames.redirect, redirect, transientOptions)

  return sendRedirect(event, getAuthorizeUrl(config, state, nonce, challenge))
}

async function exchangeAuthorizationCode(event: H3Event, code: string, codeVerifier: string) {
  const config = getConsoleOidcConfig(event)
  const endpointBaseUrl = resolveConsoleOidcEndpointBaseUrl(event, config)
  const form = new URLSearchParams()
  form.set('grant_type', 'authorization_code')
  form.set('client_id', config.clientId)
  form.set('code', code)
  form.set('redirect_uri', config.redirectUri)
  form.set('code_verifier', codeVerifier)

  return await consoleServiceFetch<ConsoleOidcTokenResponse>(event, `${endpointBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: consoleBackendRequestHeaders(event, {
      'content-type': 'application/x-www-form-urlencoded'
    }),
    body: form.toString()
  })
}

export async function refreshConsoleOidcTokens(event: H3Event) {
  const config = getConsoleOidcConfig(event)
  if (!config.enabled) {
    throw createError({ statusCode: 500, message: 'Console OIDC is not configured' })
  }
  setNoStoreHeaders(event)

  const refreshToken = getConsoleOidcRefreshToken(event)
  if (!refreshToken) {
    throw createError({ statusCode: 401, message: 'Missing refresh token' })
  }

  const form = new URLSearchParams()
  form.set('grant_type', 'refresh_token')
  form.set('client_id', config.clientId)
  form.set('refresh_token', refreshToken)

  const endpointBaseUrl = resolveConsoleOidcEndpointBaseUrl(event, config)
  const tokenSet = await consoleServiceFetch<ConsoleOidcTokenResponse>(event, `${endpointBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: consoleBackendRequestHeaders(event, {
      'content-type': 'application/x-www-form-urlencoded'
    }),
    body: form.toString()
  })

  setConsoleOidcTokenCookies(event, tokenSet)
  return tokenSet
}

function setConsoleOidcTokenCookies(event: H3Event, tokenSet: ConsoleOidcTokenResponse) {
  const accessToken = tokenSet.access_token || ''
  if (!accessToken) {
    throw createError({ statusCode: 502, message: 'Console OIDC token response missing access_token' })
  }

  const expiresIn = getTokenMaxAge(tokenSet.expires_in, 3600)
  const claims = decodeJwt(accessToken) as ConsoleOidcClaims
  const uid = String(claims.hzy?.uid || claims.sub || '').trim()
  const subjectCode = String(claims.hzy?.subjectCode || '').trim()
  const tenant = String(claims.tenant || '').trim()
  const policyVersion = String(claims.policy_ver || '').trim()
  const cookieNames = getConsoleOidcCookieNames(event)

  setNullableCookie(event, cookieNames.accessToken, accessToken, expiresIn)
  setNullableCookie(event, cookieNames.idToken, tokenSet.id_token, expiresIn)
  if (tokenSet.refresh_token) {
    const refreshExpiresIn = getTokenMaxAge(tokenSet.refresh_expires_in, 60 * 60 * 24 * 30)
    setCookie(event, cookieNames.refreshToken, tokenSet.refresh_token, getCookieBaseOptions(event, refreshExpiresIn, true))
  } else {
    deleteCookie(event, cookieNames.refreshToken, getCookieBaseOptions(event))
  }
  setNullableCookie(event, cookieNames.uid, uid, expiresIn)
  setNullableCookie(event, cookieNames.subjectCode, subjectCode, expiresIn)
  setNullableCookie(event, cookieNames.tenant, tenant, expiresIn)
  setNullableCookie(event, cookieNames.policyVersion, policyVersion, expiresIn)

  const options = getCookieBaseOptions(event)
  for (const legacyName of Object.values(consoleOidcCookies)) {
    deleteCookie(event, legacyName, options)
  }
}

export async function handleConsoleOidcCallback(event: H3Event) {
  setNoStoreHeaders(event)

  const query = getQuery(event)
  const code = firstQueryValue(query.code)
  const state = firstQueryValue(query.state)
  const transientCookieNames = getTransientCookieNames(event, state)
  const legacyTransientCookieNames = getTransientCookieNames(event)
  const selectedTransientCookieNames = getCookie(event, transientCookieNames.state)
    ? transientCookieNames
    : legacyTransientCookieNames
  const storedState = getCookie(event, selectedTransientCookieNames.state)
  const codeVerifier = getCookie(event, selectedTransientCookieNames.codeVerifier)
  const redirect = sanitizeOidcRedirect(
    event,
    getCookie(event, selectedTransientCookieNames.redirect)
  )
  const nonce = getCookie(event, selectedTransientCookieNames.nonce)

  if (!code || !state || !storedState || state !== storedState || !codeVerifier) {
    throw createError({ statusCode: 400, message: 'Invalid Console OIDC callback state' })
  }

  const tokenSet = await exchangeAuthorizationCode(event, code, codeVerifier)

  if (tokenSet.id_token && nonce) {
    const idClaims = decodeJwt(tokenSet.id_token) as ConsoleOidcClaims
    if (idClaims.nonce !== nonce) {
      throw createError({ statusCode: 401, message: 'Invalid Console OIDC nonce' })
    }
  }

  setConsoleOidcTokenCookies(event, tokenSet)

  const transientOptions = getCookieBaseOptions(event)
  for (const name of [
    ...Object.values(transientCookieNames),
    ...Object.values(legacyTransientCookieNames),
    ...Object.values(transientCookies)
  ]) {
    deleteCookie(event, name, transientOptions)
  }

  return sendRedirect(event, redirect || '/')
}

function getBearerToken(event: H3Event) {
  const authorization = String(getHeader(event, 'authorization') || '').trim()
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim()
  }

  return String(
    getCookie(event, getConsoleOidcCookieNames(event).accessToken)
    || getCookie(event, consoleOidcCookies.accessToken)
    || ''
  ).trim()
}

function getIssuerJwks(event: H3Event, issuer: string, endpointBaseUrl = issuer) {
  const jwksUrl = `${trimTrailingSlash(endpointBaseUrl || issuer)}/.well-known/jwks.json`
  const headers = consoleOidcReadHeaders(event)
  const binding = consoleServiceBinding(event)
  // Never reuse another tenant/deployment's gateway context during a JWKS
  // refresh. Keep only a digest in the cache key, not credentials.
  const contextKey = createHash('sha256').update(JSON.stringify(headers)).digest('hex')
  const cacheKey = `${issuer}|${jwksUrl}|${binding ? 'binding' : 'http'}|${contextKey}`
  const cached = jwksByIssuer.get(cacheKey)
  if (cached) {
    return cached.resolver
  }

  const headerState = { value: headers }
  const resolver = createRemoteJWKSet(new URL(jwksUrl), {
    [customFetch]: (input, init) => {
      const requestHeaders = new Headers(init?.headers)
      for (const [name, value] of Object.entries(headerState.value)) {
        requestHeaders.set(name, value)
      }
      return binding
        ? binding.fetch(normalizeConsoleServiceBindingUrl(String(input)), { ...init, headers: requestHeaders })
        : fetch(input, { ...init, headers: requestHeaders })
    }
  })
  const entry = { headerState, resolver }
  if (jwksByIssuer.size >= 64) jwksByIssuer.delete(jwksByIssuer.keys().next().value!)
  jwksByIssuer.set(cacheKey, entry)
  return resolver
}

function issuerCandidates(event: H3Event, issuer: string) {
  const config = useRuntimeConfig(event) as unknown as Record<string, unknown>
  const candidates = new Set<string>()
  addIssuerCandidate(candidates, issuer)
  addIssuerCandidate(candidates, resolveTenantGatewayConsoleOrigin(event))
  addIssuerCandidate(candidates, getCachedConsoleRuntimeConfig(event, config)?.console.issuer)
  addIssuerCandidate(candidates, getConfigValue(event, [
    'hzy.consoleOidc.issuer',
    'consoleOidc.issuer',
    'public.consoleUrl',
    'hzy.directory.consoleApiUrl'
  ]))
  addIssuerCandidate(candidates, resolveConsoleRuntimeBaseUrl(config, event))
  addIssuerCandidate(candidates, getConfigValue(event, [
    'public.deploymentPublicUrl',
    'hzy.deploymentPublicUrl'
  ]))
  return [...candidates]
}

function tokenValidationDiagnostics(
  event: H3Event,
  config: ConsoleOidcConfig,
  endpointBaseUrl: string,
  token: string,
  error: unknown
) {
  let claims: ConsoleOidcClaims | null = null
  try {
    claims = decodeJwt(token) as ConsoleOidcClaims
  } catch {
    // Keep diagnostics useful for malformed tokens without logging token data.
  }

  return {
    message: error instanceof Error ? error.message : String(error),
    expectedIssuers: issuerCandidates(event, config.issuer),
    audience: config.clientId,
    endpointHost: safeUrlHost(endpointBaseUrl),
    tokenIssuer: claims?.iss,
    tokenAudience: claims?.aud,
    tokenUse: claims?.token_use,
    subjectType: claims?.hzy?.subjectType,
    appCode: claims?.hzy?.appCode,
    scope: claims?.scope
  }
}

async function validateConsoleOidcSession(event: H3Event, config: ConsoleOidcConfig, token: string) {
  const endpointBaseUrl = resolveConsoleOidcEndpointBaseUrl(event, config)
  await consoleServiceFetch<unknown>(event, `${endpointBaseUrl}/oauth/userinfo`, {
    headers: consoleOidcReadHeaders(event, {
      authorization: `Bearer ${token}`
    })
  })
}

// Reads target Console's deployment; /oauth/token deliberately retains the
// source deployment so the issuer can authenticate the exchanging client.
function consoleOidcReadHeaders(event: H3Event, extra: Record<string, string> = {}) {
  return {
    ...consoleBackendRequestHeaders(event),
    ...(consoleServiceBinding(event) ? trustedServiceRequestHeaders(event, 'console') : {}),
    ...extra
  }
}

async function validateConsoleOidcServiceToken(event: H3Event, config: ConsoleOidcConfig, token: string) {
  const endpointBaseUrl = resolveConsoleOidcEndpointBaseUrl(event, config)
  await requireActiveConsoleServiceToken({
    endpointBaseUrl,
    token,
    headers: consoleBackendRequestHeaders(event),
    fetcher: resolveConsoleServiceTokenIntrospectionFetcher(event, endpointBaseUrl, config.clientId)
  })
}

export function validateIntrospectedServiceTokenClaims(input: {
  claims: ConsoleOidcClaims
  issuers: string[]
  audience: string
  nowSeconds?: number
}) {
  const tokenUse = String(input.claims.token_use || '').trim()
  const issuer = trimTrailingSlash(String(input.claims.iss || '').trim())
  const audiences = Array.isArray(input.claims.aud)
    ? input.claims.aud.map(value => String(value || '').trim())
    : [String(input.claims.aud || '').trim()]
  const allowedIssuers = new Set(input.issuers.map(trimTrailingSlash).filter(Boolean))
  const expiresAt = Number(input.claims.exp || 0)
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000)

  if (
    tokenUse !== 'service'
    || !issuer
    || !allowedIssuers.has(issuer)
    || !audiences.includes(input.audience)
    || !Number.isFinite(expiresAt)
    || expiresAt <= nowSeconds
  ) {
    throw new Error('introspected service token claims are invalid')
  }
}

const requestAuthMemo = createRequestAuthMemo<ConsoleAuthRequestContext>()

export async function resolveConsoleAuthContext(event: H3Event): Promise<ConsoleAuthRequestContext> {
  const config = getConsoleOidcConfig(event)
  const key = createHash('sha256').update(JSON.stringify([
    config, getBearerToken(event), consoleBackendRequestHeaders(event)
  ])).digest('hex')
  return requestAuthMemo(event, key, () => measureRequestStage(event, 'oidc', () => loadConsoleAuthContext(event)))
}

async function loadConsoleAuthContext(event: H3Event): Promise<ConsoleAuthRequestContext> {
  const config = getConsoleOidcConfig(event)
  const token = getBearerToken(event)
  if (!config.enabled) {
    return { authenticated: false, reason: 'disabled' }
  }
  if (!token) {
    return { authenticated: false, reason: 'missing_token' }
  }

  const endpointBaseUrl = resolveConsoleOidcEndpointBaseUrl(event, config)
  try {
    const decodedClaims = decodeJwt(token) as ConsoleOidcClaims
    const decodedTokenUse = String(decodedClaims.token_use || 'access')
    let claims: ConsoleOidcClaims

    if (decodedTokenUse === 'service') {
      // Console introspection is the authoritative verification boundary for a
      // service token: it verifies signature, issuer, expiry, current
      // credential and current grants against tenant-owned state. Only after
      // that succeeds may this application consume the decoded claims. This
      // avoids a second issuer-JWKS network dependency on every Worker while
      // retaining exact local issuer/audience/expiry checks.
      try {
        await validateConsoleOidcServiceToken(event, config, token)
      } catch (error) {
        const statusCode = Number((error as { statusCode?: number, status?: number })?.statusCode
          || (error as { status?: number })?.status
          || 0)
        return {
          authenticated: false,
          reason: statusCode === 401 ? 'revoked_service_token' : 'service_token_introspection_unavailable',
          token,
          claims: decodedClaims,
          tokenUse: decodedTokenUse,
          subjectType: 'service'
        }
      }
      validateIntrospectedServiceTokenClaims({
        claims: decodedClaims,
        issuers: issuerCandidates(event, config.issuer),
        audience: config.clientId
      })
      claims = decodedClaims
    } else {
      // The managed tenant issuer and the shared Console Worker publish the
      // same signing keys. Fetch keys through the direct Console endpoint to
      // avoid a Cloudflare Worker subrequest loop through the tenant domain;
      // jwtVerify still enforces the tenant issuer claim independently.
      const { payload } = await jwtVerify(token, getIssuerJwks(event, config.issuer, endpointBaseUrl), {
        issuer: issuerCandidates(event, config.issuer),
        audience: config.clientId
      })
      claims = payload as ConsoleOidcClaims
    }

    const tokenUse = String(claims.token_use || 'access')
    if (!['access', 'service'].includes(tokenUse)) {
      clearConsoleOidcCookies(event)
      return { authenticated: false, reason: 'invalid_token', token }
    }

    if (tokenUse === 'access') {
      try {
        await validateConsoleOidcSession(event, config, token)
      } catch {
        clearConsoleOidcCookies(event)
        return {
          authenticated: false,
          reason: 'revoked_session',
          token,
          claims
        }
      }
    }

    const subjectType = String(claims.hzy?.subjectType || (tokenUse === 'service' ? 'service' : 'user')).trim()

    const uid = subjectType === 'user'
      ? String(claims.hzy?.uid || claims.sub || '').trim() || undefined
      : undefined

    return {
      authenticated: true,
      token,
      claims,
      tokenUse,
      subjectType,
      uid,
      subjectCode: String(claims.hzy?.subjectCode || '').trim() || undefined,
      clientCode: String(claims.hzy?.clientCode || '').trim() || undefined,
      appCode: String(claims.hzy?.appCode || '').trim() || undefined,
      scopes: String(claims.scope || '').split(/\s+/).map(item => item.trim()).filter(Boolean),
      tenant: String(claims.tenant || '').trim() || undefined,
      deployment: String(claims.deployment || '').trim() || undefined,
      policyVersion: String(claims.policy_ver || '').trim() || undefined
    }
  } catch (error) {
    console.warn('[console-oidc] token validation failed:', tokenValidationDiagnostics(event, config, endpointBaseUrl, token, error))
    clearConsoleOidcCookies(event, { preserveRefreshToken: isExpiredJwt(token) })
    return { authenticated: false, reason: 'invalid_token', token }
  }
}

export async function requireConsoleAuthContext(event: H3Event) {
  const context = await resolveConsoleAuthContext(event)
  if (!context.authenticated) {
    throw createError({ statusCode: 401, message: 'Unauthenticated Console OIDC request' })
  }

  // Service-only routes can be deliberately bypassed by the global middleware
  // and authenticate the bearer token here instead. Downstream trusted
  // delegation helpers must see that verified context, never the middleware's
  // temporary `reason: bypass` placeholder.
  event.context.consoleAuth = context
  return context
}

export async function handleConsoleOidcRefresh(event: H3Event) {
  try {
    const tokenSet = await refreshConsoleOidcTokens(event)
    return {
      ok: true,
      expiresIn: tokenSet.expires_in || null
    }
  } catch (error) {
    if (isConsoleOidcReauthenticationRequired(error)) {
      return {
        ok: false,
        reauthenticationRequired: true,
        reason: 'session_expired_or_revoked',
        expiresIn: null
      }
    }
    throw error
  }
}

export async function handleConsoleOidcLogout(event: H3Event) {
  const config = getConsoleOidcConfig(event)
  const rawBody = event.method === 'POST' ? await readBody<{ redirect?: string, state?: string }>(event).catch(() => null) : null
  const query = getQuery(event)
  const rawRedirect = rawBody?.redirect || firstQueryValue(query.redirect) || config.logoutRedirectUri
  const redirect = rawRedirect ? sanitizeOidcRedirect(event, rawRedirect) : ''
  const state = firstQueryValue(rawBody?.state) || firstQueryValue(query.state) || 'logged_out'
  const idToken = String(
    getCookie(event, getConsoleOidcCookieNames(event).idToken)
    || getCookie(event, consoleOidcCookies.idToken)
    || ''
  ).trim()
  clearConsoleOidcCookies(event)

  if (config.enabled) {
    const logoutUrl = new URL(`${config.issuer}/oauth/logout`)
    logoutUrl.searchParams.set('state', state)
    if (redirect) {
      logoutUrl.searchParams.set('client_id', config.clientId)
      logoutUrl.searchParams.set('post_logout_redirect_uri', toAbsoluteAppRedirect(event, redirect))
    }
    if (idToken) {
      logoutUrl.searchParams.set('id_token_hint_hash', hashToken(idToken))
    }
    return sendRedirect(event, logoutUrl.toString())
  }

  return sendRedirect(event, redirect || '/login')
}

export function handleConsoleOidcPostLogout(event: H3Event) {
  const query = getQuery(event)
  const redirect = sanitizeOidcRedirect(event, firstQueryValue(query.redirect) || '/login')
  const state = firstQueryValue(query.state) || 'logged_out'
  clearConsoleOidcCookies(event)
  return sendRedirect(event, appendLoggedOutState(redirect, state))
}
