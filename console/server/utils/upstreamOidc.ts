import { createHash, randomBytes } from 'node:crypto'
import type { JWTPayload } from 'jose'
import {
  createError,
  deleteCookie,
  getCookie,
  getQuery,
  getRequestURL,
  sendRedirect,
  setCookie,
  type H3Event
} from 'h3'
import { resolveCurrentAppUrl } from '@hzy/foundation/server/utils/appUrls'
import { getAuthCookieOptions } from '@hzy/foundation/server/utils/cookie-domain'
import { getAuthRequestIp, writeAuthLoginEvent } from '~~/server/utils/authAudit'
import { resolveOrBindDirectoryIdentity } from '~~/server/utils/authIdentity'
import { createConsoleSession, hasConsoleLogoutMarker, shouldWriteLegacyAuthCookies, writeLegacyAuthCookies } from '~~/server/utils/authSession'
import { resolveConsoleLoginConfig } from '~~/server/utils/loginConfig'

type UpstreamOidcConfig = {
  enabled: boolean
  providerCode: string
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  userinfoEndpoint: string
  endSessionEndpoint: string
  jwksUri: string
  clientId: string
  clientSecret: string
  redirectUri: string
  scope: string
  postLogoutRedirectUri: string
}

type DiscoveryDocument = {
  issuer?: string
  authorization_endpoint?: string
  token_endpoint?: string
  userinfo_endpoint?: string
  end_session_endpoint?: string
  jwks_uri?: string
}

type TokenResponse = {
  access_token?: string
  id_token?: string
  token_type?: string
  expires_in?: number
}

type UserClaims = JWTPayload & {
  email?: string
  preferred_username?: string
  username?: string
  name?: string
  nickname?: string
  picture?: string
}

const cookies = {
  state: 'console_upstream_oidc_state',
  nonce: 'console_upstream_oidc_nonce',
  verifier: 'console_upstream_oidc_verifier',
  redirect: 'console_upstream_oidc_redirect',
  targetApp: 'console_upstream_oidc_target_app'
} as const

const sessionCookies = {
  idToken: 'console_upstream_oidc_id_token',
  postLogoutRedirect: 'console_upstream_oidc_post_logout_redirect'
} as const

const discoveryByIssuer = new Map<string, Promise<DiscoveryDocument>>()
const jwksByUri = new Map<string, unknown>()
type JoseModule = typeof import('jose')

let joseModulePromise: Promise<JoseModule> | null = null

function loadJose() {
  joseModulePromise ||= import('jose')
  return joseModulePromise
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function normalizeUrl(value: unknown) {
  return stringValue(value).replace(/\/+$/, '')
}

function resolveRedirectUri(event: H3Event, configured: unknown) {
  const value = stringValue(configured)
  return value || resolveCurrentAppUrl(event, '/api/auth/oidc-callback')
}

function resolvePostLogoutRedirectUri(event: H3Event, configured: unknown) {
  const value = stringValue(configured)
  return value || resolveCurrentAppUrl(event, '/api/auth/oidc-post-logout')
}

function getCookieOptions(event: H3Event, maxAge = 600) {
  return getAuthCookieOptions(event, {
    maxAge,
    httpOnly: true,
    secure: getRequestURL(event).protocol === 'https:'
  })
}

function getTokenMaxAge(token: string, fallbackSeconds: number) {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8')) as { exp?: unknown }
    const exp = typeof claims.exp === 'number' ? claims.exp : 0
    const now = Math.floor(Date.now() / 1000)
    if (exp > now) {
      return Math.max(1, exp - now)
    }
  } catch {
    // Fall back to the local session TTL below.
  }

  return fallbackSeconds
}

function randomToken(byteLength = 32) {
  return randomBytes(byteLength).toString('base64url')
}

function createPkceChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url')
}

function isLocalDevHost(hostname: string) {
  return hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)
}

function sanitizeRedirect(event: H3Event, raw: unknown) {
  const redirect = stringValue(raw)
  if (!redirect) return '/'
  if (redirect.startsWith('/') && !redirect.startsWith('//')) return redirect

  try {
    const url = new URL(redirect)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '/'

    const current = getRequestURL(event)
    const sharedDomain = getAuthCookieOptions(event).domain?.replace(/^\./, '')
    if (url.hostname === current.hostname) return url.toString()
    if (sharedDomain && url.hostname.endsWith(sharedDomain)) return url.toString()
    if (isLocalDevHost(url.hostname) && isLocalDevHost(current.hostname)) return url.toString()
  } catch {
    return '/'
  }

  return '/'
}

function getTargetApp(event: H3Event, raw: unknown) {
  const config = useRuntimeConfig(event)
  const fallback = stringValue(config.public?.appCode || config.public?.appName) || 'console'
  return stringValue(raw) || fallback
}

async function discover(issuer: string) {
  const normalizedIssuer = normalizeUrl(issuer)
  if (!normalizedIssuer) return {}

  if (!discoveryByIssuer.has(normalizedIssuer)) {
    discoveryByIssuer.set(
      normalizedIssuer,
      $fetch<DiscoveryDocument>(`${normalizedIssuer}/.well-known/openid-configuration`).catch(() => ({}))
    )
  }

  return await discoveryByIssuer.get(normalizedIssuer)!
}

async function resolveConfig(event: H3Event): Promise<UpstreamOidcConfig> {
  const login = await resolveConsoleLoginConfig(event)
  const enabled = login.oidc.enabled
  const issuer = normalizeUrl(login.oidc.issuer)
  const discovery = issuer ? await discover(issuer) : {}
  const authorizationEndpoint = stringValue(login.oidc.authorizationEndpoint || discovery.authorization_endpoint)
  const tokenEndpoint = stringValue(login.oidc.tokenEndpoint || discovery.token_endpoint)
  const userinfoEndpoint = stringValue(login.oidc.userinfoEndpoint || discovery.userinfo_endpoint)
  const jwksUri = stringValue(login.oidc.jwksUri || discovery.jwks_uri)
  const clientId = stringValue(login.oidc.clientId)

  return {
    enabled,
    providerCode: stringValue(login.oidc.providerCode) || 'sso_oidc',
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    userinfoEndpoint,
    endSessionEndpoint: stringValue(login.oidc.endSessionEndpoint || discovery.end_session_endpoint),
    jwksUri,
    clientId,
    clientSecret: stringValue(login.oidc.clientSecret),
    redirectUri: resolveRedirectUri(event, ''),
    scope: stringValue(login.oidc.scope) || 'openid profile email',
    postLogoutRedirectUri: resolvePostLogoutRedirectUri(event, '')
  }
}

export async function isUpstreamOidcEnabled(event: H3Event) {
  const config = await resolveConfig(event)
  return Boolean(config.enabled && config.authorizationEndpoint && config.tokenEndpoint && config.clientId)
}

export async function getUpstreamOidcLogoutUrl(event: H3Event, finalRedirect: string) {
  const config = await resolveConfig(event)
  if (!config.enabled || !config.endSessionEndpoint) {
    return ''
  }

  const idToken = stringValue(getCookie(event, sessionCookies.idToken))
  deleteCookie(event, sessionCookies.idToken, getCookieOptions(event, 0))
  setCookie(
    event,
    sessionCookies.postLogoutRedirect,
    sanitizeRedirect(event, finalRedirect) || '/login?logged_out=1',
    getCookieOptions(event)
  )

  const url = new URL(config.endSessionEndpoint)
  url.searchParams.set('post_logout_redirect_uri', config.postLogoutRedirectUri)
  if (idToken) {
    url.searchParams.set('id_token_hint', idToken)
  }
  if (config.clientId) {
    url.searchParams.set('client_id', config.clientId)
  }
  return url.toString()
}

export async function handleUpstreamOidcPostLogout(event: H3Event) {
  const redirect = sanitizeRedirect(event, getCookie(event, sessionCookies.postLogoutRedirect))
  deleteCookie(event, sessionCookies.postLogoutRedirect, getCookieOptions(event, 0))
  return sendRedirect(event, redirect || '/login?logged_out=1')
}

function requireUsableConfig(config: UpstreamOidcConfig) {
  if (!config.enabled) {
    throw createError({ statusCode: 500, message: 'Upstream OIDC is disabled' })
  }
  if (!config.authorizationEndpoint || !config.tokenEndpoint || !config.clientId) {
    throw createError({ statusCode: 500, message: 'Upstream OIDC configuration missing' })
  }
}

export async function startUpstreamOidcLogin(event: H3Event) {
  const query = getQuery(event)
  const config = await resolveConfig(event)
  requireUsableConfig(config)

  const redirect = sanitizeRedirect(event, query.redirect)
  const targetApp = getTargetApp(event, query.target_app)
  const forceLogin = query.force === '1'

  if (hasConsoleLogoutMarker(event) && !forceLogin) {
    const loginQuery = new URLSearchParams({ logged_out: '1' })
    if (redirect) loginQuery.set('redirect', redirect)
    return sendRedirect(event, `/login?${loginQuery.toString()}`)
  }

  const state = randomToken()
  const nonce = randomToken()
  const verifier = randomToken(48)
  const options = getCookieOptions(event)

  setCookie(event, cookies.state, state, options)
  setCookie(event, cookies.nonce, nonce, options)
  setCookie(event, cookies.verifier, verifier, options)
  setCookie(event, cookies.redirect, redirect, options)
  setCookie(event, cookies.targetApp, targetApp, options)

  const url = new URL(config.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('scope', config.scope)
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('code_challenge', createPkceChallenge(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  if (query.prompt === 'login') {
    url.searchParams.set('prompt', 'login')
    url.searchParams.set('max_age', '0')
  }
  return sendRedirect(event, url.toString())
}

async function exchangeCode(event: H3Event, config: UpstreamOidcConfig, code: string, verifier: string) {
  const body = new URLSearchParams()
  body.set('grant_type', 'authorization_code')
  body.set('client_id', config.clientId)
  if (config.clientSecret) body.set('client_secret', config.clientSecret)
  body.set('code', code)
  body.set('redirect_uri', config.redirectUri)
  body.set('code_verifier', verifier)

  return await $fetch<TokenResponse>(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  })
}

async function resolveClaims(config: UpstreamOidcConfig, tokenSet: TokenResponse, nonce: string): Promise<UserClaims> {
  if (tokenSet.id_token) {
    if (config.jwksUri && config.issuer) {
      const { createRemoteJWKSet, jwtVerify } = await loadJose()
      if (!jwksByUri.has(config.jwksUri)) {
        jwksByUri.set(config.jwksUri, createRemoteJWKSet(new URL(config.jwksUri)))
      }
      const jwks = jwksByUri.get(config.jwksUri) as ReturnType<typeof createRemoteJWKSet>
      const verified = await jwtVerify(tokenSet.id_token, jwks, {
        issuer: config.issuer,
        audience: config.clientId
      })
      if (nonce && stringValue((verified.payload as Record<string, unknown>).nonce) !== nonce) {
        throw createError({ statusCode: 401, message: 'OIDC nonce mismatch' })
      }
      return verified.payload as UserClaims
    }
  }

  if (tokenSet.access_token && config.userinfoEndpoint) {
    return await $fetch<UserClaims>(config.userinfoEndpoint, {
      headers: {
        authorization: `Bearer ${tokenSet.access_token}`
      }
    })
  }

  throw createError({ statusCode: 502, message: 'Upstream OIDC token response cannot be verified' })
}

function resolveUidCandidates(claims: UserClaims) {
  const email = stringValue(claims.email)
  const emailName = email.includes('@') ? email.split('@')[0] : ''
  return [
    claims.preferred_username,
    claims.username,
    claims.name,
    emailName,
    claims.sub
  ]
}

function clearTransientCookies(event: H3Event) {
  const options = getCookieOptions(event, 0)
  for (const name of Object.values(cookies)) {
    deleteCookie(event, name, options)
  }
}

export async function handleUpstreamOidcCallback(event: H3Event) {
  const query = getQuery(event)
  const code = stringValue(Array.isArray(query.code) ? query.code[0] : query.code)
  const state = stringValue(Array.isArray(query.state) ? query.state[0] : query.state)
  const expectedState = stringValue(getCookie(event, cookies.state))
  const nonce = stringValue(getCookie(event, cookies.nonce))
  const verifier = stringValue(getCookie(event, cookies.verifier))
  const redirect = sanitizeRedirect(event, getCookie(event, cookies.redirect))
  const targetApp = stringValue(getCookie(event, cookies.targetApp)) || getTargetApp(event, query.target_app)

  if (!code || !state || !expectedState || state !== expectedState || !verifier) {
    clearTransientCookies(event)
    await writeAuthLoginEvent({
      targetApp,
      authProvider: 'sso_oidc',
      loginType: 'oidc',
      loginResult: 'failed',
      failureReason: 'Invalid OIDC callback state',
      ipAddress: getAuthRequestIp(event)
    })
    throw createError({ statusCode: 400, message: 'Invalid OIDC callback state' })
  }

  const config = await resolveConfig(event)
  requireUsableConfig(config)

  try {
    const tokenSet = await exchangeCode(event, config, code, verifier)
    const claims = await resolveClaims(config, tokenSet, nonce)
    const providerSubject = stringValue(claims.sub)
    if (!providerSubject) {
      throw createError({ statusCode: 401, message: 'OIDC response missing subject' })
    }

    const resolved = await resolveOrBindDirectoryIdentity({
      providerCode: config.providerCode,
      providerSubject,
      providerUsername: stringValue(claims.preferred_username || claims.username || claims.email || claims.name) || providerSubject,
      email: stringValue(claims.email),
      uidCandidates: resolveUidCandidates(claims),
      profile: {
        sub: claims.sub,
        email: claims.email,
        preferred_username: claims.preferred_username,
        username: claims.username,
        name: claims.name,
        nickname: claims.nickname,
        picture: claims.picture,
        issuer: config.issuer
      }
    })
    const session = await createConsoleSession(event, {
      uid: resolved.uid,
      identityId: resolved.identityId,
      authProvider: config.providerCode
    })
    if (tokenSet.id_token) {
      setCookie(
        event,
        sessionCookies.idToken,
        tokenSet.id_token,
        getCookieOptions(event, getTokenMaxAge(tokenSet.id_token, session.ttlSeconds))
      )
    }
    if (shouldWriteLegacyAuthCookies(event)) {
      writeLegacyAuthCookies(event, session.rawSessionId, resolved.user, session.ttlSeconds)
    }

    await writeAuthLoginEvent({
      uid: resolved.uid,
      identityId: resolved.identityId,
      targetApp,
      authProvider: config.providerCode,
      loginType: 'oidc',
      loginResult: 'success',
      sessionId: session.storedSessionId,
      ipAddress: getAuthRequestIp(event)
    })

    clearTransientCookies(event)
    return sendRedirect(event, redirect)
  } catch (error: unknown) {
    clearTransientCookies(event)
    const message = error instanceof Error ? error.message : String(error)
    await writeAuthLoginEvent({
      targetApp,
      authProvider: config.providerCode,
      loginType: 'oidc',
      loginResult: 'failed',
      failureReason: message,
      ipAddress: getAuthRequestIp(event)
    })
    throw error
  }
}
