import { defineEventHandler, getQuery, setCookie, sendRedirect, createError } from 'h3'
import { reportLoginAudit } from '@hzy/foundation/server/utils/accountApi'
import { getAuthCookieOptions } from '@hzy/foundation/server/utils/cookie-domain'
import { isLegacyAuthEnabled } from '~~/server/utils/authIdentity'
import { getWecomUserByCode } from '~~/server/utils/wecom'

export default defineEventHandler(async (event) => {
  if (!isLegacyAuthEnabled(event)) {
    throw createError({
      statusCode: 410,
      message: 'AIMS direct WeCom callback is disabled. Use Console OIDC login.'
    })
  }

  const q = getQuery(event)
  const code = typeof q.code === 'string' ? q.code : ''
  const config = useRuntimeConfig()
  const defaultApp = (config.public?.appName as string) || 'aims'
  const targetApp = typeof q.target_app === 'string' && q.target_app.trim() ? q.target_app.trim() : defaultApp

  if (!code) {
    await reportLoginAudit({
      targetApp,
      loginType: 'oauth',
      loginResult: 0,
      failureReason: 'Missing OAuth code',
      ipAddress: event.node.req.socket.remoteAddress || null
    })
    throw createError({ statusCode: 400, message: '缺少授权码' })
  }

  let uid = ''
  try {
    uid = (await getWecomUserByCode(code)).userid
  } catch (error) {
    await reportLoginAudit({
      targetApp,
      loginType: 'oauth',
      loginResult: 0,
      failureReason: `获取用户信息失败: ${(error as Error)?.message || error}`,
      sessionId: code,
      ipAddress: event.node.req.socket.remoteAddress || null
    })
    throw createError({ statusCode: 401, message: '获取用户信息失败' })
  }

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

  return sendRedirect(event, '/')
})
