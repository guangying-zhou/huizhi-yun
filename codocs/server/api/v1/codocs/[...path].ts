import { proxyCurrentAppPath } from '@hzy/foundation/server/utils/apiAliasProxy'

function resolveCodocsTargetPath(path: string, method: string) {
  const normalized = path.replace(/^\/+/, '')
  const upperMethod = method.toUpperCase()

  if (upperMethod === 'POST' && normalized === 'documents') {
    return '/api/v1/documents'
  }

  if (/^documents\/[^/]+\/(content|summary|url|preview-access)$/.test(normalized)) {
    return `/api/v1/${normalized}`
  }

  if (/^documents\/(search|batch-summary)$/.test(normalized)) {
    return `/api/v1/${normalized}`
  }

  return `/api/${normalized}`
}

export default defineEventHandler((event) => {
  const path = getRouterParam(event, 'path') || ''
  const method = String(event.node.req.method || 'GET')
  return proxyCurrentAppPath(event, resolveCodocsTargetPath(path, method))
})
