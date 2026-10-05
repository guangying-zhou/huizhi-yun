export default defineEventHandler(async (event): Promise<unknown> => {
  await requireWebDevPermission(event, 'webdev_workspace', 'view')

  const id = getRouterParam(event, 'id')
  const job = await devAgentFetch(event, `/v1/jobs/${encodeURIComponent(String(id || ''))}`)
  await persistJobSnapshot(event, job as Record<string, unknown>)
  return job
})
