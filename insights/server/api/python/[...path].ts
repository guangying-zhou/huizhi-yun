export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const path = getRouterParam(event, 'path') || ''
  const method = event.node.req.method || 'GET'
  if (!isPublicInsightsPythonApiRequest(path, method)) {
    requireInsightsApiPermission(event, resolveInsightsPythonApiPermission(path, method))
  }
  const targetUrl = `${config.pythonBackendUrl}/api/${path}`

  return proxyRequest(event, targetUrl)
})
