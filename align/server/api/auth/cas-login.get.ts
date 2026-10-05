import { defineEventHandler, getQuery, sendRedirect } from 'h3'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const config = useRuntimeConfig(event)
  const casBaseUrl = (config.public?.casBaseUrl as string) || ''
  const defaultApp = String(config.public?.appCode || config.public?.appName || 'align')
  const targetApp = typeof query.target_app === 'string' && query.target_app.trim() ? query.target_app.trim() : defaultApp

  if (!casBaseUrl) {
    throw createError({ statusCode: 500, message: 'CAS configuration missing' })
  }

  const req = event.node.req
  const protocol = req.headers['x-forwarded-proto'] || 'http'
  const host = req.headers['host']
  const serviceUrl = `${protocol}://${host}/api/auth/cas-callback?target_app=${encodeURIComponent(targetApp)}`

  const loginUrl = `${casBaseUrl.replace(/\/$/, '')}/cas/login?service=${encodeURIComponent(serviceUrl)}`

  return sendRedirect(event, loginUrl)
})
