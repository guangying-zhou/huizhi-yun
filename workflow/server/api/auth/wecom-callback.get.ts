import { defineEventHandler, getQuery, setCookie, sendRedirect } from 'h3'
import { getAuthCookieOptions } from '@hzy/foundation/server/utils/cookie-domain'
import { getWecomUserByCode } from '~~/server/utils/wecom'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const code = typeof q.code === 'string' ? q.code : ''

  if (!code) {
    throw createError({ statusCode: 400, message: '缺少授权码' })
  }

  const config = useRuntimeConfig()
  const defaultApp = (config.public?.appCode as string) || (config.public?.appName as string) || 'workflow'
  const targetApp = typeof q.target_app === 'string' && q.target_app.trim() ? q.target_app.trim() : defaultApp
  const userInfo = await getWecomUserByCode(code)

  const uid = userInfo.userid

  const cookieOptions = getAuthCookieOptions(event)
  setCookie(event, 'token', code, cookieOptions)
  setCookie(event, 'auth_user', uid, cookieOptions)

  console.info('[WeComAuth] Login succeeded', { uid, targetApp })

  return sendRedirect(event, String(config.public?.appBasePath || '/'))
})
