/**
 * 企业微信 OAuth2 回调
 * 路由: GET /api/wecom/oauth?code=CODE&state=REDIRECT_PATH
 *
 * 流程：code → userid → 邮箱 → Account 用户 → 设置 cookies → 重定向
 */
import { getWecomUserByCode, getWecomUserDetail } from '../../utils/wecom'
import { getAuthCookieDomain, getAuthCookieOptions } from '@hzy/foundation/server/utils/cookie-domain'
import { getUserByEmail } from '../../utils/accountLookup'
import { fetchDirectoryUser } from '~~/server/utils/directoryCompat'

interface WecomOAuthQuery {
  code?: string
  state?: string
}

export default defineEventHandler(async (event) => {
  const query = getQuery<WecomOAuthQuery>(event)
  const code = query.code || ''
  const state = query.state || '/'

  console.log('[Wecom OAuth] callback received, code:', code?.substring(0, 10) + '...', 'state:', state)

  if (!code) {
    throw createError({
      statusCode: 400,
      message: 'Missing code parameter'
    })
  }

  try {
    // 1. 通过 code 获取企业微信 userid
    const { userid } = await getWecomUserByCode(code)
    console.log('[Wecom OAuth] userid:', userid)

    // 2. 获取用户详情（邮箱）
    const wecomUser = await getWecomUserDetail(userid)
    console.log('[Wecom OAuth] userid:', userid, 'bizMail:', wecomUser.bizMail, 'email:', wecomUser.email, 'name:', wecomUser.name)

    // 3. 匹配 Account 系统用户：企业邮箱 → 个人邮箱 → userid → userid小写
    let accountUser = null
    if (wecomUser.bizMail) {
      accountUser = await getUserByEmail(wecomUser.bizMail)
    }
    if (!accountUser && wecomUser.email && wecomUser.email !== wecomUser.bizMail) {
      accountUser = await getUserByEmail(wecomUser.email)
    }
    if (!accountUser) {
      accountUser = await fetchDirectoryUser(userid).catch(() => null)
    }
    if (!accountUser) {
      accountUser = await fetchDirectoryUser(userid.toLowerCase()).catch(() => null)
    }
    if (!accountUser) {
      throw createError({
        statusCode: 403,
        message: `No account found for WeChat Work user: ${userid} (bizMail: ${wecomUser.bizMail || 'none'}, email: ${wecomUser.email || 'none'})`
      })
    }

    console.log('[Wecom OAuth] matched account uid:', accountUser.uid)

    // 4. 设置认证 cookies（与 CAS 登录保持一致）
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

    // 部门信息 — 统一使用 deptCode 字符串编码
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
    // 5. 重定向到目标页面
    return sendRedirect(event, state, 302)
  } catch (error: unknown) {
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode) || 500
      : 500
    const message = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message)
        : 'WeChat Work login failed'
    console.error('[Wecom OAuth] Error:', message)
    // 清除 wecom_checked，下次访问可以重试
    const domain = getAuthCookieDomain(event)
    deleteCookie(event, 'wecom_checked', {
      path: '/',
      ...(domain ? { domain } : {})
    })
    if (statusCode !== 500) {
      throw createError({ statusCode, message })
    }
    throw createError({
      statusCode: 500,
      message: `WeChat Work login failed: ${message}`
    })
  }
})
