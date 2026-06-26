export default defineEventHandler(async (event): Promise<unknown> => {
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const jobId = String(id || '')
  const eventQuery = {
    after: typeof query.after === 'string' ? query.after : undefined
  }

  if (query.source === 'history') {
    const historyResult = await dataRuntimeFetch(event, `/v1/webdev/jobs/${encodeURIComponent(jobId)}/events`, {
      query: eventQuery
    })
    const historyEvents = Array.isArray((historyResult as { data?: unknown[] }).data)
      ? (historyResult as { data: unknown[] }).data
      : []
    return { events: historyEvents }
  }

  const result = await devAgentFetch(event, `/v1/jobs/${encodeURIComponent(jobId)}/events`, {
    query: eventQuery
  })
  const events = Array.isArray((result as { events?: unknown[] }).events)
    ? (result as { events: Record<string, unknown>[] }).events
    : []
  await persistJobEvents(event, jobId, events)
  return result
})
