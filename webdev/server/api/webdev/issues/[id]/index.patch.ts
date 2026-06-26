export default defineEventHandler(async (event): Promise<unknown> => {
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)
  const input = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  const auth = event.context.consoleAuth as { uid?: string } | undefined

  const result = await dataRuntimeFetch(event, `/v1/webdev/issues/${encodeURIComponent(String(id || ''))}`, {
    method: 'PATCH',
    body: {
      ...input,
      actor: auth?.uid || 'system'
    }
  })
  const issue = (result as { data?: unknown })?.data ?? result

  // 状态流转到待验证/已解决/已关闭时通知反馈人（best-effort）
  const nextState = String(input.state || '')
  if (['verifying', 'resolved', 'closed'].includes(nextState)) {
    await notifyIssueUpdate(event, issue as Parameters<typeof notifyIssueUpdate>[1], { eventType: 'state_changed' })
  }
  return issue
})
