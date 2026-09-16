import { defineEventHandler, getQuery, setCookie, sendRedirect } from 'h3'
import { getAuthCookieOptions } from '@hzy/foundation/server/utils/cookie-domain'
import { getUserByUid, getRequestIp, reportLoginAudit } from '@hzy/foundation/server/utils/accountApi'
import { getWecomUserByCode, getWecomUserDetail } from '~~/server/utils/wecom'
import { getUserByEmail } from '~~/server/utils/accountLookup'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const code = typeof q.code === 'string' ? q.code : ''
  const config = useRuntimeConfig()
  const defaultApp = String(config.public?.appCode || config.public?.appName || 'align')
  const targetApp = typeof q.target_app === 'string' && q.target_app.trim() ? q.target_app.trim() : defaultApp

  if (!code) {
    await reportLoginAudit({
      targetApp,
      loginType: 'oauth',
      loginResult: 0,
      failureReason: 'Missing OAuth code',
      ipAddress: getRequestIp(event)
    })
    throw createError({ statusCode: 400, message: '缺少授权码' })
  }

  try {
    const { userid } = await getWecomUserByCode(code)
    const wecomUser = await getWecomUserDetail(userid)

    let accountUser = null
    if (wecomUser.email) {
      accountUser = await getUserByEmail(wecomUser.email)
    }
    if (!accountUser) {
      accountUser = await getUserByUid(userid)
    }
    if (!accountUser) {
      accountUser = await getUserByUid(userid.toLowerCase())
    }
    if (!accountUser) {
      await reportLoginAudit({
        targetApp,
        loginType: 'oauth',
        loginResult: 0,
        failureReason: `No account found for WeChat Work user: ${userid}`,
        sessionId: code,
        ipAddress: getRequestIp(event)
      })
      throw createError({
        statusCode: 403,
        message: `未找到对应的系统账号：${userid}`
      })
    }

    const cookieOptions = getAuthCookieOptions(event)
    setCookie(event, 'token', `wecom_${userid}_${Date.now()}`, cookieOptions)
    setCookie(event, 'auth_user', accountUser.uid, cookieOptions)

    if (accountUser.email) {
      setCookie(event, 'auth_email', accountUser.email, cookieOptions)
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

    await reportLoginAudit({
      uid: accountUser.uid,
      targetApp,
      loginType: 'oauth',
      loginResult: 1,
      sessionId: code,
      ipAddress: getRequestIp(event)
    })

    return sendRedirect(event, '/')
  } catch (error: unknown) {
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode) || 500
      : 500
    const message = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message)
        : 'WeChat Work login failed'

    if (statusCode !== 403) {
      console.error('[Wecom Callback] Error:', message)
    }

    throw createError({ statusCode, message })
  }
})
