import { defineEventHandler, getQuery, setCookie, sendRedirect, createError } from 'h3'
import { getAuthCookieOptions } from '@hzy/foundation/server/utils/cookie-domain'
import { getRequestIp, getUserByUid, reportLoginAudit } from '@hzy/foundation/server/utils/accountApi'

export default defineEventHandler(async (event) => {
  const getMobileTail = (mobile: string | null | undefined) => {
    const digits = String(mobile || '').replace(/\D/g, '')
    return digits.length >= 4 ? digits.slice(-4) : ''
  }

  const q = getQuery(event)
  const ticket = typeof q.ticket === 'string' ? q.ticket : (Array.isArray(q.ticket) ? q.ticket[0] : '')

  if (!ticket) {
    throw createError({ statusCode: 400, message: 'Missing ticket' })
  }

  const config = useRuntimeConfig(event)
  const defaultApp = String(config.public?.appCode || config.public?.appName || 'align')
  const targetApp = typeof q.target_app === 'string' && q.target_app.trim() ? q.target_app.trim() : defaultApp
  const casBaseUrl = (config.public?.casBaseUrl as string) || ''

  const req = event.node.req
  const protocol = req.headers['x-forwarded-proto'] || 'http'
  const host = req.headers['host']
  const serviceUrl = `${protocol}://${host}/api/auth/cas-callback?target_app=${encodeURIComponent(targetApp)}`

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

  const mMail = xml.match(/<cas:mail>([^<]+)<\/cas:mail>/) || xml.match(/<cas:email>([^<]+)<\/cas:email>/)
  const email = mMail && mMail[1] ? mMail[1] : ''

  const cookieOptions = getAuthCookieOptions(event)
  setCookie(event, 'token', ticket, cookieOptions)
  setCookie(event, 'auth_user', uid, cookieOptions)
  if (email) {
    setCookie(event, 'auth_email', email, cookieOptions)
  }

  // 补齐用户资料
  try {
    const accountUser = await getUserByUid(uid)
    if (accountUser) {
      const tail = getMobileTail(accountUser.mobile)
      if (tail) setCookie(event, 'auth_mobile_tail4', tail, cookieOptions)

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
    console.warn('[CAS callback] Failed to enrich account user info:', error)
  }

  await reportLoginAudit({
    uid,
    targetApp,
    loginType: 'sso',
    loginResult: 1,
    sessionId: ticket,
    ipAddress: getRequestIp(event)
  })

  return sendRedirect(event, '/')
})
