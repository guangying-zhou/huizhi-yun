import { defineEventHandler, getQuery, sendRedirect } from 'h3'
import { deriveWecomCallbackUrl } from '@hzy/foundation/server/utils/appUrls'
import { getWecomOAuthIntegrationConfig } from '@hzy/foundation/server/utils/wecomIntegration'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const config = useRuntimeConfig()
  const { corpid, agentid } = await getWecomOAuthIntegrationConfig()
  const defaultApp = (config.public?.appCode as string) || (config.public?.appName as string) || 'workflow'
  const targetApp = typeof query.target_app === 'string' && query.target_app.trim() ? query.target_app.trim() : defaultApp

  const req = event.node.req
  const redirectUri = deriveWecomCallbackUrl(event, new URLSearchParams({ target_app: targetApp }))

  const userAgent = req.headers['user-agent'] || ''
  const isWeWorkClient = /wxwork/i.test(userAgent)

  let authUrl: string

  if (isWeWorkClient) {
    authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${corpid}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=snsapi_base&agentid=${agentid}&state=STATE#wechat_redirect`
  } else {
    authUrl = `https://open.work.weixin.qq.com/wwopen/sso/qrConnect?appid=${corpid}&agentid=${agentid}&redirect_uri=${encodeURIComponent(redirectUri)}&state=STATE`
  }

  return sendRedirect(event, authUrl)
})
