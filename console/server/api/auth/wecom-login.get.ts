import { defineEventHandler, getQuery, sendRedirect } from 'h3'
import { deriveWecomCallbackUrl } from '@hzy/foundation/server/utils/appUrls'
import { hasConsoleLogoutMarker } from '~~/server/utils/authSession'
import { resolveConsoleLoginConfig } from '~~/server/utils/loginConfig'

function getRedirectParam(value: unknown) {
  const redirect = typeof value === 'string' ? value.trim() : ''
  if (!redirect) return ''
  if (redirect.startsWith('/') || redirect.startsWith('http://') || redirect.startsWith('https://')) return redirect
  return ''
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const config = useRuntimeConfig()
  const loginConfig = await resolveConsoleLoginConfig(event)
  const corpId = loginConfig.wecom.corpid || config.wecom.corpid
  const agentId = loginConfig.wecom.agentid || config.wecom.agentid
  const defaultApp = String(config.public?.appCode || config.public?.appName || 'console')
  const targetApp = typeof query.target_app === 'string' && query.target_app.trim() ? query.target_app.trim() : defaultApp
  const redirect = getRedirectParam(query.redirect)
  const forceLogin = query.force === '1'

  if (hasConsoleLogoutMarker(event) && !forceLogin) {
    const loginQuery = new URLSearchParams({ logged_out: '1' })
    if (redirect) loginQuery.set('redirect', redirect)
    return sendRedirect(event, `/login?${loginQuery.toString()}`)
  }

  if (!corpId || !agentId) {
    throw createError({ statusCode: 500, message: '企业微信未配置' })
  }

  const req = event.node.req
  const callbackQuery = new URLSearchParams({ target_app: targetApp })
  if (redirect) callbackQuery.set('redirect', redirect)
  const redirectUri = deriveWecomCallbackUrl(event, callbackQuery)

  const userAgent = req.headers['user-agent'] || ''
  const isWeWorkClient = /wxwork/i.test(userAgent)

  let authUrl: string

  if (isWeWorkClient) {
    authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${corpId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=snsapi_base&agentid=${agentId}&state=STATE#wechat_redirect`
  } else {
    authUrl = `https://open.work.weixin.qq.com/wwopen/sso/qrConnect?appid=${corpId}&agentid=${agentId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=STATE`
  }

  return sendRedirect(event, authUrl)
})
