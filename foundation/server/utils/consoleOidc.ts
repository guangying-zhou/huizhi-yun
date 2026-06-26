import { createHash, randomBytes } from 'node:crypto'
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose'
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
  setResponseStatus,
  type H3Event
} from 'h3'
import { getAuthCookieOptions } from './cookie-domain'
import { deriveOidcCallbackUrl, getRequestOrigin, resolveCurrentAppUrl } from './appUrls'
import { getCachedConsoleRuntimeConfig, resolveConsoleRuntimeBaseUrl, resolveTenantGatewayConsoleOrigin } from './consoleRuntime'

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
  reason?: 'disabled' | 'missing_token' | 'invalid_token' | 'revoked_session' | 'bypass'
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

function getTransientCookieNames(event: H3Event) {
  const scope = resolveCookieScope(event)
  return {
    state: scopedCookieName(scope, 'oidc_state'),
    nonce: scopedCookieName(scope, 'oidc_nonce'),
    codeVerifier: scopedCookieName(scope, 'oidc_code_verifier'),
    redirect: scopedCookieName(scope, 'oidc_redirect')
  } as const
}

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>()
const consoleBackendHeaderNames = [
  'x-hzy-gateway',
  'x-hzy-gateway-token',
  'x-hzy-tenant',
  'x-hzy-deployment',
  'x-hzy-environment',
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
  const cachedRuntimeBaseUrl = String(getCachedConsoleRuntimeConfig()?.console.baseUrl || '').trim()

  return trimTrailingSlash(
    configured
    || internalRuntimeUrl
    || runtimeConfigured
    || cachedRuntimeBaseUrl
    || resolveConsoleRuntimeBaseUrl(useRuntimeConfig(event) as unknown as Record<string, unknown>)
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

  const runtimeIssuer = String(getCachedConsoleRuntimeConfig()?.console.issuer || '').trim()
  if (runtimeIssuer) {
    return trimTrailingSlash(runtimeIssuer)
  }

  const configured = getConfigValue(event, [
    'hzy.consoleOidc.issuer',
    'consoleOidc.issuer',
    'public.consoleUrl',
    'hzy.directory.consoleApiUrl'
  ]) || resolveConsoleRuntimeBaseUrl(config) || ''
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
  const transientCookieNames = getTransientCookieNames(event)

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

  return await $fetch<ConsoleOidcTokenResponse>(`${endpointBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: consoleBackendRequestHeaders(event, {
      'content-type': 'application/x-www-form-urlencoded'
    }),
    body: form
  })
}

export async function refreshConsoleOidcTokens(event: H3Event) {
  const config = getConsoleOidcConfig(event)
  if (!config.enabled) {
    throw createError({ statusCode: 500, message: 'Console OIDC is not configured' })
  }
  setNoStoreHeaders(event)

  const cookieNames = getConsoleOidcCookieNames(event)
  const refreshToken = getCookie(event, cookieNames.refreshToken) || getCookie(event, consoleOidcCookies.refreshToken)
  if (!refreshToken) {
    throw createError({ statusCode: 401, message: 'Missing refresh token' })
  }

  const form = new URLSearchParams()
  form.set('grant_type', 'refresh_token')
  form.set('client_id', config.clientId)
  form.set('refresh_token', refreshToken)

  const endpointBaseUrl = resolveConsoleOidcEndpointBaseUrl(event, config)
  const tokenSet = await $fetch<ConsoleOidcTokenResponse>(`${endpointBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: consoleBackendRequestHeaders(event, {
      'content-type': 'application/x-www-form-urlencoded'
    }),
    body: form
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
    setCookie(event, cookieNames.refreshToken, tokenSet.refresh_token, getCookieBaseOptions(event, 60 * 60 * 24 * 30, true))
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
  const transientCookieNames = getTransientCookieNames(event)
  const storedState = getCookie(event, transientCookieNames.state)
  const codeVerifier = getCookie(event, transientCookieNames.codeVerifier)
  const redirect = sanitizeOidcRedirect(event, getCookie(event, transientCookieNames.redirect))
  const nonce = getCookie(event, transientCookieNames.nonce)

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

function getIssuerJwks(issuer: string, endpointBaseUrl = issuer) {
  const jwksUrl = `${trimTrailingSlash(endpointBaseUrl || issuer)}/.well-known/jwks.json`
  const cacheKey = `${issuer}|${jwksUrl}`
  const cached = jwksByIssuer.get(cacheKey)
  if (cached) {
    return cached
  }

  const jwks = createRemoteJWKSet(new URL(jwksUrl))
  jwksByIssuer.set(cacheKey, jwks)
  return jwks
}

function issuerCandidates(event: H3Event, issuer: string) {
  const config = useRuntimeConfig(event) as unknown as Record<string, unknown>
  const candidates = new Set<string>()
  addIssuerCandidate(candidates, issuer)
  addIssuerCandidate(candidates, resolveTenantGatewayConsoleOrigin(event))
  addIssuerCandidate(candidates, getCachedConsoleRuntimeConfig()?.console.issuer)
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
  await $fetch(`${endpointBaseUrl}/oauth/userinfo`, {
    headers: consoleBackendRequestHeaders(event, {
      authorization: `Bearer ${token}`
    })
  })
}

export async function resolveConsoleAuthContext(event: H3Event): Promise<ConsoleAuthRequestContext> {
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
    const { payload } = await jwtVerify(token, getIssuerJwks(config.issuer, endpointBaseUrl), {
      issuer: issuerCandidates(event, config.issuer),
      audience: config.clientId
    })
    const claims = payload as ConsoleOidcClaims
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

  return context
}

export async function handleConsoleOidcRefresh(event: H3Event) {
  try {
    const tokenSet = await refreshConsoleOidcTokens(event)
    return {
      ok: true,
      expiresIn: tokenSet.expires_in || null
    }
  } catch {
    clearConsoleOidcCookies(event)
    setResponseStatus(event, 401)
    return {
      ok: false,
      expiresIn: null
    }
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
