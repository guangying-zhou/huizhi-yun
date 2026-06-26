export default defineEventHandler(async (event): Promise<unknown> => {
  const body = await readBody(event)
  const input = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  const auth = event.context.consoleAuth as { uid?: string } | undefined

  const result = await dataRuntimeFetch(event, '/v1/webdev/issues', {
    method: 'POST',
    body: {
      ...input,
      source: 'manual',
      reporterUid: input.reporterUid || auth?.uid,
      reporterName: input.reporterName || auth?.uid
    }
  })
  return (result as { data?: unknown })?.data ?? result
})
