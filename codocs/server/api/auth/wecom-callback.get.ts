import { defineEventHandler, getHeader, getQuery, setCookie, sendRedirect } from 'h3'
import { getAuthCookieOptions } from '@hzy/foundation/server/utils/cookie-domain'
import { reportLoginAudit } from '@hzy/foundation/server/utils/accountApi'
import { getUserByEmail } from '~~/server/utils/accountLookup'
import { fetchDirectoryUser } from '~~/server/utils/directoryCompat'
import { getWecomUserByCode, getWecomUserDetail } from '~~/server/utils/wecom'

interface LoginAuditPayload {
  uid?: string
  targetApp?: string
  loginType: 'password' | 'sso' | 'oauth'
  loginResult: 0 | 1
  failureReason?: string
  sessionId?: string
  ipAddress?: string | null
}

function getRequestIp(event: Parameters<typeof getHeader>[0]) {
  const forwarded = getHeader(event, 'x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || null
  return getHeader(event, 'x-real-ip') || null
}

async function writeLoginAudit(payload: LoginAuditPayload) {
  try {
    await reportLoginAudit(payload)
  } catch (error) {
    console.warn('[WecomCallback] Failed to report login audit:', error)
  }
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const code = typeof q.code === 'string' ? q.code : ''
  const targetApp = typeof q.target_app === 'string' && q.target_app.trim() ? q.target_app.trim() : 'codocs'

  if (!code) {
    await writeLoginAudit({
      targetApp,
      loginType: 'oauth',
      loginResult: 0,
      failureReason: 'Missing OAuth code',
      ipAddress: getRequestIp(event)
    })
    throw createError({ statusCode: 400, message: '缺少授权码' })
  }

  try {
    // 1. 通过 code 获取企业微信 userid
    const { userid } = await getWecomUserByCode(code)

    // 2. 获取用户详情（邮箱）
    const wecomUser = await getWecomUserDetail(userid)

    // 3. 匹配 Account 系统用户：优先邮箱，fallback 用 userid 作为 uid
    let accountUser = null
    if (wecomUser.email) {
      accountUser = await getUserByEmail(wecomUser.email)
    }
    if (!accountUser) {
      accountUser = await fetchDirectoryUser(userid).catch(() => null)
    }
    if (!accountUser) {
      accountUser = await fetchDirectoryUser(userid.toLowerCase()).catch(() => null)
    }
    if (!accountUser) {
      await writeLoginAudit({
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

    // 4. 设置认证 cookies（使用系统 uid，与 wecom/oauth 保持一致）
    const cookieOpts = getAuthCookieOptions(event)
    setCookie(event, 'token', `wecom_${userid}_${Date.now()}`, cookieOpts)
    setCookie(event, 'auth_user', accountUser.uid, cookieOpts)

    if (accountUser.email) {
      setCookie(event, 'auth_email', accountUser.email, cookieOpts)
    }
    if (accountUser.realName) {
      setCookie(event, 'auth_realname', accountUser.realName, cookieOpts)
    }
    if (accountUser.nickname) {
      setCookie(event, 'auth_nickname', accountUser.nickname, cookieOpts)
    }
    if (accountUser.avatar) {
      setCookie(event, 'auth_avatar', accountUser.avatar, cookieOpts)
    }
    if (accountUser.department) {
      if (accountUser.department.name) {
        setCookie(event, 'auth_department', accountUser.department.name, cookieOpts)
      }
      const deptCode = accountUser.department.code || accountUser.department.id
      if (deptCode) {
        setCookie(event, 'auth_dept_code', String(deptCode), cookieOpts)
      }
    } else if (accountUser.deptCode && accountUser.deptName) {
      setCookie(event, 'auth_department', accountUser.deptName, cookieOpts)
      setCookie(event, 'auth_dept_code', accountUser.deptCode, cookieOpts)
    }

    // 5. 记录登录日志（使用系统 uid）
    await writeLoginAudit({
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
