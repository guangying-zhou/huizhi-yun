export default defineEventHandler(async (event): Promise<unknown> => {
  const result = await dataRuntimeFetch(event, '/v1/webdev/issues/settings')
  return (result as { data?: unknown })?.data ?? result
})
