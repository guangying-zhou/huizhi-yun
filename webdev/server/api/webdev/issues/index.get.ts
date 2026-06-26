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

export default defineEventHandler(async (event): Promise<IssueListResponse> => {
  const query = getQuery(event)
  const result = await dataRuntimeFetch(event, '/v1/webdev/issues', {
    query: {
      page: queryValue(query.page),
      pageSize: queryValue(query.pageSize),
      state: queryValue(query.state),
      appCode: queryValue(query.appCode),
      scope: queryValue(query.scope),
      pageKey: queryValue(query.pageKey),
      severity: queryValue(query.severity),
      reporterUid: queryValue(query.reporterUid),
      keyword: queryValue(query.keyword)
    }
  })
  return normalizeListResponse(result)
})
