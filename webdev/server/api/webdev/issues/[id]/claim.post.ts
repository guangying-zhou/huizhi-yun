export default defineEventHandler(async (event): Promise<unknown> => {
  const id = String(getRouterParam(event, 'id') || '')
  const auth = event.context.consoleAuth as { uid?: string } | undefined
  const actor = auth?.uid || 'system'

  return await claimIssueAndCreateJob(event, id, { actor, autoClaimed: false, createdBy: auth?.uid })
})
