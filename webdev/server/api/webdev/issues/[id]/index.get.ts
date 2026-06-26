export default defineEventHandler(async (event): Promise<unknown> => {
  const id = getRouterParam(event, 'id')
  const result = await dataRuntimeFetch(event, `/v1/webdev/issues/${encodeURIComponent(String(id || ''))}`)
  return (result as { data?: unknown })?.data ?? result
})
