import { defineEventHandler, getQuery, sendRedirect } from 'h3'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const config = useRuntimeConfig()
  const corpId = config.wecom.corpid
  const agentId = config.wecom.agentid
  const defaultApp = String(config.public?.appCode || config.public?.appName || 'align')
  const targetApp = typeof query.target_app === 'string' && query.target_app.trim() ? query.target_app.trim() : defaultApp

  if (!corpId || !agentId) {
    throw createError({ statusCode: 500, message: '企业微信未配置' })
  }

  const req = event.node.req
  const protocol = req.headers['x-forwarded-proto'] || 'http'
  const host = req.headers['host']
  const redirectUri = `${protocol}://${host}/api/auth/wecom-callback?target_app=${encodeURIComponent(targetApp)}`

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
