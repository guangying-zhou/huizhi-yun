export default defineEventHandler(async (event): Promise<unknown> => {
  await requireWebDevPermission(event, 'webdev_workspace', 'execute')

  const id = getRouterParam(event, 'id')
  const job = await devAgentFetch(event, `/v1/jobs/${encodeURIComponent(String(id || ''))}/cancel`, {
    method: 'POST'
  })
  await persistJobSnapshot(event, job as Record<string, unknown>)
  return job
})
