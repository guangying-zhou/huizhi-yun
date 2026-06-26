import { defineEventHandler, getQuery, setCookie, sendRedirect } from 'h3'
import { reportLoginAudit } from '@hzy/foundation/server/utils/accountApi'
import { getAuthCookieOptions } from '@hzy/foundation/server/utils/cookie-domain'
import { getWecomUserByCode } from '~~/server/utils/wecom'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const defaultApp = (config.public?.appCode as string) || 'assets'
  const appBasePath = String(config.public?.appBasePath || '/').replace(/\/?$/, '/')
  const q = getQuery(event)
  const code = typeof q.code === 'string' ? q.code : ''

  if (!code) {
    await reportLoginAudit({
      targetApp: defaultApp,
      loginType: 'oauth',
      loginResult: 0,
      failureReason: 'Missing OAuth code',
      ipAddress: event.node.req.socket.remoteAddress || null
    })
    throw createError({ statusCode: 400, message: '缺少授权码' })
  }

  const targetApp = typeof q.target_app === 'string' && q.target_app.trim() ? q.target_app.trim() : defaultApp
  const userInfo = await getWecomUserByCode(code).catch(async (error) => {
    const failureReason = error instanceof Error ? error.message : '获取用户信息失败'
    await reportLoginAudit({
      targetApp,
      loginType: 'oauth',
      loginResult: 0,
      failureReason,
      sessionId: code,
      ipAddress: event.node.req.socket.remoteAddress || null
    })
    throw createError({ statusCode: 401, message: failureReason })
  })

  const uid = userInfo.userid

  const cookieOptions = getAuthCookieOptions(event)
  setCookie(event, 'token', code, cookieOptions)
  setCookie(event, 'auth_user', uid, cookieOptions)

  await reportLoginAudit({
    uid,
    targetApp,
    loginType: 'oauth',
    loginResult: 1,
    sessionId: code,
    ipAddress: event.node.req.socket.remoteAddress || null
  })

  return sendRedirect(event, appBasePath)
})
