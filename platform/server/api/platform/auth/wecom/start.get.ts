import { randomBytes } from 'node:crypto'
import { getHeader, sendRedirect, setCookie } from 'h3'
import {
  buildPlatformWecomRedirectUri,
  getPlatformWecomConfig
} from '~~/server/utils/wecomPlatformAuth'

const WECOM_MOBILE_AUTH_ENDPOINT = 'https://open.weixin.qq.com/connect/oauth2/authorize'
const WECOM_QR_AUTH_ENDPOINT = 'https://open.work.weixin.qq.com/wwopen/sso/qrConnect'
const STATE_COOKIE = 'hzy_wecom_oauth_state'
const REDIRECT_COOKIE = 'hzy_wecom_oauth_redirect'
const OAUTH_COOKIE_MAX_AGE_SECONDS = 10 * 60

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function normalizeRedirect(value: unknown) {
  const redirect = normalizeString(value)
  if (!redirect || !redirect.startsWith('/admin') || redirect.startsWith('//')) {
    return '/admin'
  }

  return redirect
}

function oauthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/api/platform/auth/wecom',
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const state = randomBytes(24).toString('base64url')
  const redirect = normalizeRedirect(query.redirect)
  const config = getPlatformWecomConfig(event)
  const redirectUri = buildPlatformWecomRedirectUri(event, config.redirectUri)
  const userAgent = normalizeString(getHeader(event, 'user-agent'))
  const isWeWorkClient = /wxwork/i.test(userAgent)

  setCookie(event, STATE_COOKIE, state, oauthCookieOptions())
  setCookie(event, REDIRECT_COOKIE, redirect, oauthCookieOptions())

  const url = new URL(isWeWorkClient ? WECOM_MOBILE_AUTH_ENDPOINT : WECOM_QR_AUTH_ENDPOINT)
  if (isWeWorkClient) {
    url.searchParams.set('appid', config.corpid)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'snsapi_base')
    url.searchParams.set('agentid', config.agentid)
    url.searchParams.set('state', state)
    url.hash = 'wechat_redirect'
  } else {
    url.searchParams.set('appid', config.corpid)
    url.searchParams.set('agentid', config.agentid)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('state', state)
  }

  return sendRedirect(event, url.toString(), 302)
})
