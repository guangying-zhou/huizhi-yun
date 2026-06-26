type IssueListResponse = {
  items: unknown[]
  total: number
  page: number
  pageSize: number
}

function queryValue(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function normalizeListResponse(result: unknown): IssueListResponse {
  const payload = ((result as { data?: unknown })?.data || result || {}) as Partial<IssueListResponse> & { page_size?: number }
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    total: Number(payload.total || 0),
    page: Number(payload.page || 1),
    pageSize: Number(payload.pageSize || payload.page_size || 20)
  }
}

// 报告组件「我已提报」列表：service token 鉴权，按来源应用 + 提交者过滤（替代自动去重）。
// page_key 由服务端用 appCode（来自 token）+ 客户端 routePattern 拼装，不信任客户端直传完整 key。
export default defineEventHandler(async (event): Promise<IssueListResponse> => {
  const ctx = await requireWebDevService(event, ['webdev:issue:read', 'webdev:issue:write', 'webdev:read', 'webdev:write'])
  const appCode = String(ctx?.appCode || '')
  const query = getQuery(event)
  const scope = queryValue(query.scope)
  const routePattern = queryValue(query.routePattern)
  const pageKey = scope === 'page' && routePattern ? `${appCode}:${routePattern}` : undefined

  const result = await dataRuntimeFetch(event, '/v1/webdev/issues', {
    query: {
      page: 1,
      pageSize: queryValue(query.pageSize) || 20,
      appCode: appCode || undefined,
      reporterUid: queryValue(query.reporterUid),
      scope: scope === 'app' ? 'app' : scope === 'page' ? 'page' : undefined,
      pageKey
    }
  })
  return normalizeListResponse(result)
})
