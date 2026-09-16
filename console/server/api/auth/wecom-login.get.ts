import { defineEventHandler, getQuery, sendRedirect } from 'h3'
import { hasConsoleLogoutMarker } from '~~/server/utils/authSession'
import { resolveConsoleLoginConfig } from '~~/server/utils/loginConfig'
import { createWeComBrowserAuthorization, getWeComOAuthPublicConfig } from '~~/server/utils/wecom'
import { issueExternalLoginTransaction } from '~~/server/utils/externalLoginState'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const config = useRuntimeConfig(event)
  const loginConfig = await resolveConsoleLoginConfig(event)
  const defaultApp = String(config.public?.appCode || config.public?.appName || 'console')
  const forceLogin = query.force === '1'

  if (hasConsoleLogoutMarker(event) && !forceLogin) {
    const loginQuery = new URLSearchParams({ logged_out: '1' })
    if (typeof query.redirect === 'string' && query.redirect.trim()) loginQuery.set('redirect', query.redirect.trim())
    return sendRedirect(event, `/login?${loginQuery.toString()}`)
  }

  if (!loginConfig.wecom.enabled) {
    throw createError({ statusCode: 503, message: '企业微信登录未启用' })
  }

  const { corpid: corpId, agentid: agentId } = await getWeComOAuthPublicConfig(event)
  const transaction = await issueExternalLoginTransaction(event, {
    provider: 'wecom',
    targetApp: query.target_app,
    redirect: query.redirect,
    defaultApp
  })

  const authorization = await createWeComBrowserAuthorization(transaction.state, event)

  const userAgent = event.node.req.headers['user-agent'] || ''
  const isWeWorkClient = /wxwork/i.test(userAgent)

  let authUrl: string

  if (isWeWorkClient) {
    const params = new URLSearchParams({
      appid: corpId,
      redirect_uri: authorization.redirectUri,
      response_type: 'code',
      scope: 'snsapi_base',
      agentid: agentId,
      state: transaction.state
    })
    authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?${params.toString()}#wechat_redirect`
  } else {
    const params = new URLSearchParams({
      appid: corpId,
      agentid: agentId,
      redirect_uri: authorization.redirectUri,
      state: transaction.state
    })
    authUrl = `https://open.work.weixin.qq.com/wwopen/sso/qrConnect?${params.toString()}`
  }

  return sendRedirect(event, authUrl)
})
