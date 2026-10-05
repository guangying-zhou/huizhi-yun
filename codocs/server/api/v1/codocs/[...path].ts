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
  const normalized = path.replace(/^\/+/, '')
  if (
    (method.toUpperCase() === 'GET' && normalized === 'documents/search')
    || (method.toUpperCase() === 'POST' && normalized === 'documents/batch-summary')
  ) {
    throw createError({
      statusCode: 503,
      statusMessage: 'scoped_document_service_contract_required',
      message: 'Generic document service reads require a source-bound scoped service contract.'
    })
  }
  return proxyCurrentAppPath(event, resolveCodocsTargetPath(path, method))
})
