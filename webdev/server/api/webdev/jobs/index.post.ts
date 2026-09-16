export default defineEventHandler(async (event): Promise<unknown> => {
  const body = await readBody(event)
  const permission = resolveWebDevJobPermission(body)
  await requireWebDevPermission(event, permission.resource, permission.action)

  const job = await devAgentFetch(event, '/v1/jobs', {
    method: 'POST',
    body
  })

  const bodyRecord = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  const jobRecord = job && typeof job === 'object' && !Array.isArray(job)
    ? job as Record<string, unknown>
    : {}
  const auth = event.context.consoleAuth as { uid?: string } | undefined
  const snapshot: Record<string, unknown> = {
    ...bodyRecord,
    ...jobRecord
  }
  if (auth?.uid) {
    snapshot.createdBy = auth.uid
  }
  await persistJobSnapshot(event, snapshot)
  return job
})
