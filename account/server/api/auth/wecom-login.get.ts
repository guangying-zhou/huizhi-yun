import { defineEventHandler, getQuery, sendRedirect } from 'h3'
import { sanitizeAuthRedirect } from '@hzy/foundation/server/utils/casAuth'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const config = useRuntimeConfig()
  const corpId = config.wecom.corpId
  const agentId = config.wecom.agentId
  const targetApp = typeof query.target_app === 'string' && query.target_app.trim() ? query.target_app.trim() : 'account'
  const redirect = sanitizeAuthRedirect(event, query.redirect)

  if (!corpId || !agentId) {
    throw createError({ statusCode: 500, message: '企业微信未配置' })
  }

  const req = event.node.req
  const protocol = req.headers['x-forwarded-proto'] || 'http'
  const host = req.headers['host']
  const callbackQuery = new URLSearchParams({ target_app: targetApp })
  if (redirect && redirect !== '/') {
    callbackQuery.set('redirect', redirect)
  }
  const redirectUri = `${protocol}://${host}/api/auth/wecom-callback?${callbackQuery.toString()}`

  // 检查 User-Agent 判断是否在企业微信客户端内
  const userAgent = req.headers['user-agent'] || ''
  const isWeWorkClient = /wxwork/i.test(userAgent)

  let authUrl: string

  if (isWeWorkClient) {
    // 企业微信客户端内：使用 OAuth2 授权
    authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${corpId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=snsapi_base&agentid=${agentId}&state=STATE#wechat_redirect`
  } else {
    // 浏览器：使用扫码登录
    authUrl = `https://open.work.weixin.qq.com/wwopen/sso/qrConnect?appid=${corpId}&agentid=${agentId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=STATE`
  }

  return sendRedirect(event, authUrl)
})
