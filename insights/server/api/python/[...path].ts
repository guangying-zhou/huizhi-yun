export default defineEventHandler(async (event) => {
  const token = getCookie(event, 'token')
  if (!token) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const config = useRuntimeConfig()
  const path = getRouterParam(event, 'path') || ''
  const targetUrl = `${config.pythonBackendUrl}/api/${path}`

  return proxyRequest(event, targetUrl)
})
