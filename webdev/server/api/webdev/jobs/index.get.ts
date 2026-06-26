type JobRecord = {
  id: string
  projectId?: string
  repoId?: string
  agentId?: string
  type: string
  status: string
  templateId?: string
  target?: string
  prompt?: string
  createdBy?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  exitCode?: number
  error?: string
  eventCount?: number
}

type JobListResponse = {
  items: JobRecord[]
  total: number
  page: number
  pageSize: number
}

function queryValue(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function normalizeListResponse(result: unknown): JobListResponse {
  const payload = ((result as { data?: unknown })?.data || result || {}) as Partial<JobListResponse> & { page_size?: number }
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    total: Number(payload.total || 0),
    page: Number(payload.page || 1),
    pageSize: Number(payload.pageSize || payload.page_size || 20)
  }
}

export default defineEventHandler(async (event): Promise<JobListResponse> => {
  const query = getQuery(event)
  const result = await dataRuntimeFetch(event, '/v1/webdev/jobs', {
    query: {
      page: queryValue(query.page),
      pageSize: queryValue(query.pageSize),
      status: queryValue(query.status),
      keyword: queryValue(query.keyword),
      repoId: queryValue(query.repoId)
    }
  })
  return normalizeListResponse(result)
})
