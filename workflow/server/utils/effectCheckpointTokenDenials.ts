export type WorkflowEffectCheckpointKind = 'notification' | 'actionable' | 'callback'

// In-process only: counts effect checkpoint calls rejected by service-token
// issuance or Runtime scope checks since this worker/process started.
let checkpointTokenDenied = 0

function failureStatus(error: unknown) {
  const value = (error || {}) as { statusCode?: unknown, status?: unknown, response?: { status?: unknown } }
  return Number(value.statusCode ?? value.status ?? value.response?.status)
}

// createError data.code values such as insufficient_scope or
// console_service_token_grant_inactive; never messages, URLs or tokens.
function failureCode(error: unknown) {
  const code = String((error as { data?: { code?: unknown } } | null)?.data?.code || '').trim()
  return /^[a-z][a-z0-9_.:-]{2,79}$/.test(code) ? code : ''
}

export function recordWorkflowEffectCheckpointFailure(
  error: unknown,
  kind: WorkflowEffectCheckpointKind,
  log: (message: string, detail: unknown) => void = (message, detail) => console.error(message, detail)
) {
  const causeStatus = failureStatus(error)
  if (causeStatus !== 401 && causeStatus !== 403) return false
  checkpointTokenDenied += 1
  const causeCode = failureCode(error)
  log('[WorkflowRuntime] 投递检查点的服务令牌或 scope 被拒绝', {
    code: 'workflow_effect_checkpoint_token_denied',
    kind,
    causeStatus,
    ...(causeCode ? { causeCode } : {})
  })
  return true
}

/** Counts a 401/403 checkpoint failure and rethrows it unchanged. */
export async function withWorkflowEffectCheckpointTokenDenial<T>(
  kind: WorkflowEffectCheckpointKind,
  run: () => Promise<T>,
  log?: (message: string, detail: unknown) => void
) {
  try {
    return await run()
  } catch (error) {
    recordWorkflowEffectCheckpointFailure(error, kind, log)
    throw error
  }
}

export function workflowEffectCheckpointTokenDenials() {
  return checkpointTokenDenied
}
