export default defineEventHandler(async (event): Promise<unknown> => {
  const body = await readBody(event)
  const input = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  const result = await dataRuntimeFetch(event, '/v1/webdev/issues/settings', {
    method: 'PUT',
    body: input
  })
  return (result as { data?: unknown })?.data ?? result
})
