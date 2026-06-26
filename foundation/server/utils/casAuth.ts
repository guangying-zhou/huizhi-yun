/**
 * Legacy Auth Bridge: CAS 登录桥。
 *
 * 仅供当前存量 `CAS -> foundation/account -> app` 链路使用。
 * 新平台 `hzy_platform` 的 Identity Plane 不应继续复用本文件作为主协议入口。
 */
import { createError, getQuery, sendRedirect, setCookie, type H3Event } from 'h3'
import { getUserByUid, reportLoginAudit, getRequestIp } from './accountApi'
import { getAuthCookieOptions } from './cookie-domain'
import { deriveCasCallbackUrl, getRequestOrigin } from './appUrls'

function isLocalDevHost(hostname: string): boolean {
  return hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)
}

export function sanitizeAuthRedirect(event: H3Event, raw: unknown): string {
  if (typeof raw !== 'string') return '/'
  const trimmed = raw.trim()
  if (!trimmed) return '/'

  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed
  }

  try {
    const target = new URL(trimmed)
    if (!['http:', 'https:'].includes(target.protocol)) {
      return '/'
    }

    const current = new URL(getRequestOrigin(event))
    const sharedDomain = getAuthCookieOptions(event).domain?.replace(/^\./, '')

    if (target.hostname === current.hostname) {
      return target.toString()
    }

    if (sharedDomain && target.hostname.endsWith(sharedDomain)) {
      return target.toString()
    }

    if (isLocalDevHost(current.hostname) && isLocalDevHost(target.hostname)) {
      return target.toString()
    }
  } catch {
    return '/'
  }

  return '/'
}

function getTargetApp(event: H3Event, raw: unknown): string {
  const runtimeApp = String(useRuntimeConfig(event).public?.appName || '').trim()
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim()
  }
  return runtimeApp || 'app'
}

function buildCallbackServiceUrl(event: H3Event, targetApp: string, redirect: string): string {
  const query = new URLSearchParams({ target_app: targetApp })
  if (redirect && redirect !== '/') {
    query.set('redirect', redirect)
  }
  return deriveCasCallbackUrl(event, query)
}

function getMobileTail(mobile: string | null | undefined) {
  const digits = String(mobile || '').replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : ''
}

async function fillOptionalRoleCookie(event: H3Event, email: string, cookieOptions: ReturnType<typeof getAuthCookieOptions>) {
  if (!email) return

  try {
    const sysUser = await $fetch<{ umask?: number }>('/api/system/users/by-email', {
      params: { email }
    })
    if (typeof sysUser?.umask === 'number') {
      setCookie(event, 'auth_role', String(sysUser.umask), cookieOptions)
    }
  } catch {
    // 仅 account 模块具备该接口，其他模块忽略即可。
  }
}

export async function handleCasLogin(event: H3Event) {
  const query = getQuery(event)
  const config = useRuntimeConfig(event)
  const casBaseUrl = String(config.public?.casBaseUrl || '').trim()
  const targetApp = getTargetApp(event, query.target_app)
  const redirect = sanitizeAuthRedirect(event, query.redirect)

  if (!casBaseUrl) {
    throw createError({ statusCode: 500, message: 'CAS configuration missing' })
  }

  const serviceUrl = buildCallbackServiceUrl(event, targetApp, redirect)
  const loginUrl = `${casBaseUrl.replace(/\/$/, '')}/cas/login?service=${encodeURIComponent(serviceUrl)}`
  return sendRedirect(event, loginUrl)
}

export async function handleCasCallback(event: H3Event) {
  const query = getQuery(event)
  const ticket = typeof query.ticket === 'string'
    ? query.ticket
    : (Array.isArray(query.ticket) ? query.ticket[0] : '')
  const targetApp = getTargetApp(event, query.target_app)
  const redirect = sanitizeAuthRedirect(event, query.redirect)

  if (!ticket) {
    throw createError({ statusCode: 400, message: 'Missing ticket' })
  }

  const config = useRuntimeConfig(event)
  const casBaseUrl = String(config.public?.casBaseUrl || '').trim()
  const serviceUrl = buildCallbackServiceUrl(event, targetApp, redirect)
  const validateUrl = `${casBaseUrl.replace(/\/$/, '')}/cas/p3/serviceValidate?service=${encodeURIComponent(serviceUrl)}&ticket=${encodeURIComponent(ticket)}`

  const xml = await $fetch<string>(validateUrl, { responseType: 'text' })

  if (!xml.includes('<cas:authenticationSuccess')) {
    await reportLoginAudit({
      targetApp,
      loginType: 'sso',
      loginResult: 0,
      failureReason: 'CAS validation failed',
      sessionId: ticket,
      ipAddress: getRequestIp(event)
    })
    throw createError({ statusCode: 401, message: 'CAS validation failed' })
  }

  const userMatch = xml.match(/<cas:user>([^<]+)<\/cas:user>/)
  const uid = (userMatch?.[1] || '').trim()
  if (!uid) {
    throw createError({ statusCode: 401, message: 'No uid in CAS response' })
  }

  const emailMatch = xml.match(/<cas:mail>([^<]+)<\/cas:mail>/) || xml.match(/<cas:email>([^<]+)<\/cas:email>/)
  const email = emailMatch?.[1] || ''

  const cookieOptions = getAuthCookieOptions(event)
  setCookie(event, 'token', ticket, cookieOptions)
  setCookie(event, 'auth_user', uid, cookieOptions)
  if (email) {
    setCookie(event, 'auth_email', email, cookieOptions)
  }

  try {
    const accountUser = await getUserByUid(uid)
    if (accountUser) {
      setCookie(event, 'auth_id', String(accountUser.id), cookieOptions)

      const tail = getMobileTail(accountUser.mobile)
      if (tail) {
        setCookie(event, 'auth_mobile_tail4', tail, cookieOptions)
      }
      if (accountUser.realName) {
        setCookie(event, 'auth_realname', accountUser.realName, cookieOptions)
        setCookie(event, 'auth_real_name', accountUser.realName, cookieOptions)
        setCookie(event, 'real_name', accountUser.realName, cookieOptions)
      }
      if (accountUser.nickname) {
        setCookie(event, 'auth_nickname', accountUser.nickname, cookieOptions)
      }
      if (accountUser.avatar) {
        setCookie(event, 'auth_avatar', accountUser.avatar, cookieOptions)
      }
      if (accountUser.department) {
        if (accountUser.department.name) {
          setCookie(event, 'auth_department', accountUser.department.name, cookieOptions)
        }
        const deptCode = accountUser.department.code || accountUser.department.id
        if (deptCode) {
          setCookie(event, 'auth_dept_code', String(deptCode), cookieOptions)
        }
      } else if (accountUser.deptCode && accountUser.deptName) {
        setCookie(event, 'auth_department', accountUser.deptName, cookieOptions)
        setCookie(event, 'auth_dept_code', accountUser.deptCode, cookieOptions)
      }
    }
  } catch (error) {
    console.warn('[Foundation CAS callback] Failed to enrich account user info:', error)
  }

  await fillOptionalRoleCookie(event, email, cookieOptions)

  await reportLoginAudit({
    uid,
    targetApp,
    loginType: 'sso',
    loginResult: 1,
    sessionId: ticket,
    ipAddress: getRequestIp(event)
  })

  return sendRedirect(event, redirect || '/')
}
