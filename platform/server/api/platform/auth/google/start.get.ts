import { randomBytes } from 'node:crypto'
import { getRequestURL, sendRedirect, setCookie } from 'h3'

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const STATE_COOKIE = 'hzy_google_oauth_state'
const REDIRECT_COOKIE = 'hzy_google_oauth_redirect'
const OAUTH_COOKIE_MAX_AGE_SECONDS = 10 * 60

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

function oauthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/api/platform/auth/google',
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS
  }
}

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const authConfig = runtimeConfig.auth || {}
  const clientId = configValue(authConfig.googleClientId, 'GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = configValue(authConfig.googleClientSecret, 'GOOGLE_OAUTH_CLIENT_SECRET')

  if (!clientId || !clientSecret) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Google 登录未配置'
    })
  }

  const query = getQuery(event)
  const state = randomBytes(24).toString('base64url')
  const redirect = normalizeRedirect(query.redirect)
  const redirectUri = buildRedirectUri(event, configValue(authConfig.googleRedirectUri, 'GOOGLE_OAUTH_REDIRECT_URI'))
  const hostedDomain = configValue(authConfig.googleHostedDomain, 'GOOGLE_OAUTH_HOSTED_DOMAIN')

  setCookie(event, STATE_COOKIE, state, oauthCookieOptions())
  setCookie(event, REDIRECT_COOKIE, redirect, oauthCookieOptions())

  const url = new URL(GOOGLE_AUTH_ENDPOINT)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', state)
  url.searchParams.set('access_type', 'online')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('prompt', 'select_account')

  if (hostedDomain) {
    url.searchParams.set('hd', hostedDomain)
  }

  return sendRedirect(event, url.toString(), 302)
})
