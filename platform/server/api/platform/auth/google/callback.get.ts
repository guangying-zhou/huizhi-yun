import { getCookie, getRequestURL, sendRedirect, setCookie } from 'h3'
import { parseCsvSet } from '~~/server/utils/access'
import { ok } from '~~/server/utils/api'
import {
  createPlatformSession,
  touchAccountLogin,
  upsertGoogleAdmin
} from '~~/server/utils/platformAuth'

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'
const STATE_COOKIE = 'hzy_google_oauth_state'
const REDIRECT_COOKIE = 'hzy_google_oauth_redirect'

type GoogleTokenResponse = {
  access_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  id_token?: string
  error?: string
  error_description?: string
}

type GoogleUserInfoResponse = {
  sub?: string
  email?: string
  email_verified?: boolean | string
  name?: string
  picture?: string
  hd?: string
}

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function cloudflareEnvValue(name: string) {
  const env = globalThis.__hzyCloudflareEnv as Record<string, unknown> | undefined
  return normalizeString(env?.[name])
}

function configValue(value: unknown, envName: string) {
  return normalizeString(value) || cloudflareEnvValue(envName)
}

function normalizeEmail(value: unknown) {
  return normalizeString(value).toLowerCase()
}

function normalizeDomain(value: unknown) {
  const email = normalizeEmail(value)
  return email.includes('@') ? email.split('@').pop() || '' : ''
}

function normalizeRedirect(value: unknown) {
  const redirect = normalizeString(value)
  if (!redirect || !redirect.startsWith('/admin') || redirect.startsWith('//')) {
    return '/admin'
  }

  return redirect
}

function buildRedirectUri(event: Parameters<typeof getRequestURL>[0], configuredRedirectUri: unknown) {
  const configured = normalizeString(configuredRedirectUri)
  if (configured) {
    return configured
  }

  const runtimeConfig = useRuntimeConfig()
  const serviceUrl = normalizeString(runtimeConfig.public?.serviceUrl)
  if (serviceUrl) {
    return `${serviceUrl.replace(/\/+$/, '')}/api/platform/auth/google/callback`
  }

  const url = getRequestURL(event)
  return `${url.origin}/api/platform/auth/google/callback`
}

function clearOauthCookies(event: Parameters<typeof setCookie>[0]) {
  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/api/platform/auth/google',
    maxAge: 0
  }

  setCookie(event, STATE_COOKIE, '', options)
  setCookie(event, REDIRECT_COOKIE, '', options)
}

function buildLoginRedirect(message: string) {
  const url = new URL('/admin/login', 'https://platform.local')
  url.searchParams.set('googleError', message)
  return `${url.pathname}${url.search}`
}

function isEmailVerified(value: unknown) {
  return value === true || normalizeString(value).toLowerCase() === 'true'
}

function canProvisionGoogleAccount(email: string, allowedEmails: Set<string>, allowedDomains: Set<string>) {
  if (allowedEmails.has(email)) {
    return true
  }

  const domain = normalizeDomain(email)
  return Boolean(domain && allowedDomains.has(domain))
}

async function exchangeCodeForToken(options: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
}) {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      code: options.code,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.redirectUri,
      grant_type: 'authorization_code'
    })
  })
  const payload = await response.json() as GoogleTokenResponse

  if (!response.ok || !payload.access_token) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: payload.error_description || payload.error || 'Google token exchange failed'
    })
  }

  return payload
}

async function fetchGoogleUserInfo(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  })
  const payload = await response.json() as GoogleUserInfoResponse

  if (!response.ok || !payload.sub || !payload.email) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: 'Google userinfo fetch failed'
    })
  }

  return payload
}

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const authConfig = runtimeConfig.auth || {}
  const query = getQuery(event)
  const redirect = normalizeRedirect(getCookie(event, REDIRECT_COOKIE))

  try {
    const expectedState = normalizeString(getCookie(event, STATE_COOKIE))
    const actualState = normalizeString(query.state)
    const code = normalizeString(query.code)

    if (normalizeString(query.error)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        message: normalizeString(query.error_description) || normalizeString(query.error)
      })
    }

    if (!expectedState || !actualState || expectedState !== actualState) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        message: 'Google 登录 state 校验失败'
      })
    }

    if (!code) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'Google 登录缺少授权码'
      })
    }

    const clientId = configValue(authConfig.googleClientId, 'GOOGLE_OAUTH_CLIENT_ID')
    const clientSecret = configValue(authConfig.googleClientSecret, 'GOOGLE_OAUTH_CLIENT_SECRET')

    if (!clientId || !clientSecret) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Service Unavailable',
        message: 'Google 登录未配置'
      })
    }

    const token = await exchangeCodeForToken({
      code,
      clientId,
      clientSecret,
      redirectUri: buildRedirectUri(event, configValue(authConfig.googleRedirectUri, 'GOOGLE_OAUTH_REDIRECT_URI'))
    })
    const profile = await fetchGoogleUserInfo(token.access_token!)
    const email = normalizeEmail(profile.email)
    const allowedEmails = new Set([...parseCsvSet(configValue(authConfig.googleAllowedEmails, 'GOOGLE_OAUTH_ALLOWED_EMAILS'))].map(item => item.toLowerCase()))
    const allowedDomains = new Set([...parseCsvSet(configValue(authConfig.googleAllowedDomains, 'GOOGLE_OAUTH_ALLOWED_DOMAINS'))].map(item => item.toLowerCase()))
    const allowProvision = canProvisionGoogleAccount(email, allowedEmails, allowedDomains)
    const account = await upsertGoogleAdmin({
      email,
      emailVerified: isEmailVerified(profile.email_verified),
      subject: normalizeString(profile.sub),
      displayName: normalizeString(profile.name) || email,
      picture: normalizeString(profile.picture) || undefined,
      hostedDomain: normalizeString(profile.hd) || undefined,
      allowProvision
    })

    const sessionUuid = await createPlatformSession(event, {
      accountId: account.id,
      idpType: 'google_oidc',
      sessionScope: 'platform_admin',
      ttlSeconds: Number(authConfig.sessionTtlSeconds) || undefined
    })

    await touchAccountLogin(account.id)
    clearOauthCookies(event)

    if (query.mode === 'json') {
      return ok({
        account: {
          uid: account.uid,
          username: account.username,
          email: account.email,
          displayName: account.display_name,
          accountType: account.account_type
        },
        session: {
          sessionUuid,
          scope: 'platform_admin'
        },
        redirect
      })
    }

    return sendRedirect(event, redirect, 302)
  } catch (error) {
    clearOauthCookies(event)

    if (query.mode === 'json') {
      throw error
    }

    const message = error && typeof error === 'object' && 'message' in error
      ? normalizeString((error as { message?: string }).message)
      : 'Google 登录失败'

    return sendRedirect(event, buildLoginRedirect(message || 'Google 登录失败'), 302)
  }
})
