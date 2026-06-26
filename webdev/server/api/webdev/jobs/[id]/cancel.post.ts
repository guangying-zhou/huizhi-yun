export default defineEventHandler(async (event): Promise<unknown> => {
  const id = getRouterParam(event, 'id')
  const job = await devAgentFetch(event, `/v1/jobs/${encodeURIComponent(String(id || ''))}/cancel`, {
    method: 'POST'
  })
  await persistJobSnapshot(event, job as Record<string, unknown>)
  return job
})
