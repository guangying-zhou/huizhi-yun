import { defineEventHandler, getQuery, sendRedirect } from 'h3'
import { deriveCasCallbackUrl } from '@hzy/foundation/server/utils/appUrls'
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
  const config = useRuntimeConfig(event)
  const loginConfig = await resolveConsoleLoginConfig(event)
  const casBaseUrl = loginConfig.cas.baseUrl || (config.public?.casBaseUrl as string) || ''
  const defaultApp = String(config.public?.appCode || config.public?.appName || 'console')
  const targetApp = typeof query.target_app === 'string' && query.target_app.trim() ? query.target_app.trim() : defaultApp
  const redirect = getRedirectParam(query.redirect)
  const forceLogin = query.force === '1'

  if (hasConsoleLogoutMarker(event) && !forceLogin) {
    const loginQuery = new URLSearchParams({ logged_out: '1' })
    if (redirect) loginQuery.set('redirect', redirect)
    return sendRedirect(event, `/login?${loginQuery.toString()}`)
  }

  if (!casBaseUrl) {
    throw createError({ statusCode: 500, message: 'CAS configuration missing' })
  }

  const callbackQuery = new URLSearchParams({ target_app: targetApp })
  if (redirect) callbackQuery.set('redirect', redirect)
  const serviceUrl = deriveCasCallbackUrl(event, callbackQuery)

  const loginUrl = `${casBaseUrl.replace(/\/$/, '')}/cas/login?service=${encodeURIComponent(serviceUrl)}`

  return sendRedirect(event, loginUrl)
})
