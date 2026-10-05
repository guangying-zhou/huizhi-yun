import { createError, readBody } from 'h3'
import { appendConsoleHumanOperationLog } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import {
  cancelDeadLetterPlatformLifecycleForRetry,
  loadDeadLetterPlatformLifecycleRetrySource
} from '~~/server/utils/platformLifecycleActionableDrain'
import { executePlatformLifecycleRetryCommand } from '~~/server/utils/platformLifecycleOperation'
import { parsePlatformLifecycleRetryIdentity, type PlatformLifecycleRetryIdentity } from '~~/server/utils/platformLifecycleRetryContract'

function retryActionForPhase(phase: PlatformLifecycleRetryIdentity['phase']) {
  return phase === 'employment_authorization_sync'
    ? 'directory.user.employment_authorization.retry'
    : 'directory.user.offboarding_authorization.retry'
}

async function writeRetryOperationLog(input: {
  event: Parameters<typeof appendConsoleHumanOperationLog>[0]
  action: string
  uid: string
  actorUid: string
  idempotencyKey: string
  reason: string
  phase: PlatformLifecycleRetryIdentity['phase']
  result: 'success' | 'failed'
  detail: Record<string, unknown>
}) {
  await appendConsoleHumanOperationLog(input.event, {
    sourceApp: 'directory',
    action: input.action,
    targetType: 'directory_user',
    targetId: input.uid,
    operatorUid: input.actorUid,
    sessionId: input.idempotencyKey,
    result: input.result,
    detail: {
      phase: input.phase,
      reason: input.reason,
      ...input.detail
    }
  }, `${input.idempotencyKey}:audit:${input.result}`)
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'authorization_lifecycle', 'admin', '需要授权生命周期管理权限')

  const body = await readBody<unknown>(event).catch(() => undefined)
  const { phase, uid } = parsePlatformLifecycleRetryIdentity(body)
  const retrySource = await loadDeadLetterPlatformLifecycleRetrySource({
    event,
    uid,
    phase
  })
  if (!retrySource) {
    throw createError({ statusCode: 409, message: 'current lifecycle dead-letter operation is unavailable for retry' })
  }

  const actorUid = await requireConsoleRequestUid(event)
  const action = retryActionForPhase(phase)
  const reason = `manual_${phase}_retry`
  const idempotencyKey = `console:platform-lifecycle:${retrySource.operationId}:manual-${phase}-retry:v1`

  try {
    const result = await executePlatformLifecycleRetryCommand(retrySource)
    await cancelDeadLetterPlatformLifecycleForRetry({ event, uid, phase, operationId: retrySource.operationId })

    await writeRetryOperationLog({
      event,
      action,
      uid,
      actorUid,
      idempotencyKey,
      reason,
      phase,
      result: 'success',
      detail: { retryResult: result }
    })

    return { code: 0, message: 'ok', data: { phase, uid, result } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown error')
    await writeRetryOperationLog({
      event,
      action,
      uid,
      actorUid,
      idempotencyKey,
      reason,
      phase,
      result: 'failed',
      detail: { error: message }
    }).catch((logError) => {
      const logMessage = logError instanceof Error ? logError.message : String(logError || 'unknown error')
      console.warn('[console] Failed to write lifecycle retry operation log:', { uid, phase, error: logMessage })
    })
    throw error
  }
})
