import { defineEventHandler, getQuery, sendRedirect } from 'h3'
import { deriveDingTalkCallbackUrl } from '@hzy/foundation/server/utils/appUrls'
import { hasConsoleLogoutMarker } from '~~/server/utils/authSession'
import { getDingTalkOAuthPublicConfig } from '~~/server/utils/dingtalk'
import { issueExternalLoginTransaction } from '~~/server/utils/externalLoginState'
import { resolveConsoleLoginConfig } from '~~/server/utils/loginConfig'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const config = useRuntimeConfig(event)
  const loginConfig = await resolveConsoleLoginConfig(event)
  const defaultApp = String(config.public?.appCode || config.public?.appName || 'console')
  if (hasConsoleLogoutMarker(event) && query.force !== '1') {
    return sendRedirect(event, '/login?logged_out=1')
  }
  if (!loginConfig.dingtalk.enabled) {
    throw createError({ statusCode: 503, message: '钉钉登录未启用' })
  }
  const { clientId, integrationCode } = await getDingTalkOAuthPublicConfig(event)
  const transaction = await issueExternalLoginTransaction(event, {
    provider: 'dingtalk', integrationCode, targetApp: query.target_app, redirect: query.redirect, defaultApp
  })
  const params = new URLSearchParams({
    redirect_uri: deriveDingTalkCallbackUrl(event),
    response_type: 'code',
    client_id: clientId,
    scope: 'openid corpid Contact.User.Read',
    state: transaction.state,
    prompt: 'consent'
  })
  return sendRedirect(event, `https://login.dingtalk.com/oauth2/auth?${params.toString()}`)
})
