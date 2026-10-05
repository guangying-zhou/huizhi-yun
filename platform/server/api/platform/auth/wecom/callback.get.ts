import { getCookie, sendRedirect, setCookie } from 'h3'
import { parseBooleanLike, parseCsvSet } from '~~/server/utils/access'
import { ok } from '~~/server/utils/api'
import {
  createPlatformSession,
  touchAccountLogin,
  upsertWecomAdmin
} from '~~/server/utils/platformAuth'
import {
  getPlatformWecomConfig,
  getPlatformWecomUserByCode,
  getPlatformWecomUserDetail,
  platformWecomConfigValue
} from '~~/server/utils/wecomPlatformAuth'

const STATE_COOKIE = 'hzy_wecom_oauth_state'
const REDIRECT_COOKIE = 'hzy_wecom_oauth_redirect'

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

function clearOauthCookies(event: Parameters<typeof setCookie>[0]) {
  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/api/platform/auth/wecom',
    maxAge: 0
  }

  setCookie(event, STATE_COOKIE, '', options)
  setCookie(event, REDIRECT_COOKIE, '', options)
}

function buildLoginRedirect(message: string) {
  const url = new URL('/admin/login', 'https://platform.local')
  url.searchParams.set('wecomError', message)
  return `${url.pathname}${url.search}`
}

function canProvisionWecomAccount(userid: string, allowedUserids: Set<string>, allowAll: boolean) {
  if (allowAll) {
    return true
  }

  const normalized = userid.toLowerCase()
  return allowedUserids.has(userid) || allowedUserids.has(normalized)
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
        message: '企业微信登录 state 校验失败'
      })
    }

    if (!code) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: '企业微信登录缺少授权码'
      })
    }

    const config = getPlatformWecomConfig(event)
    const wecomUser = await getPlatformWecomUserByCode(code, config)
    const profile = await getPlatformWecomUserDetail(wecomUser.userid, config)
    const allowedUserids = new Set(
      [...parseCsvSet(platformWecomConfigValue(authConfig.wecomAllowedUserids, 'WECOM_OAUTH_ALLOWED_USERIDS'))]
        .flatMap(item => [item, item.toLowerCase()])
    )
    const allowAll = parseBooleanLike(
      platformWecomConfigValue(authConfig.wecomAllowAll, 'WECOM_OAUTH_ALLOW_ALL'),
      false
    )
    const allowProvision = canProvisionWecomAccount(profile.userid, allowedUserids, allowAll)
    const account = await upsertWecomAdmin({
      userid: profile.userid,
      corpid: config.corpid,
      displayName: normalizeString(profile.name) || profile.userid,
      email: profile.email,
      mobile: profile.mobile,
      avatar: profile.avatar,
      allowProvision
    })

    const sessionUuid = await createPlatformSession(event, {
      accountId: account.id,
      idpType: 'wecom',
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
      : '企业微信登录失败'

    return sendRedirect(event, buildLoginRedirect(message || '企业微信登录失败'), 302)
  }
})
