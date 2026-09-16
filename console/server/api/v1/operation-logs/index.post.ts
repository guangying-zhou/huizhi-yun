import { appendConsoleOperationLog } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getAuthRequestIp } from '~~/server/utils/authAudit'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

interface OperationLogRequest {
  sourceApp?: string
  sessionId?: string
  action?: string
  targetType?: string
  targetId?: string | number
  detail?: string | Record<string, unknown>
  result?: 'success' | 'failed'
  operatorUid?: string
  operatorUserId?: number
}

function nullableString(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(event, 'audit', 'audit:write')
  requireIdempotencyKey(event)
  const body = await readBody<OperationLogRequest>(event)
  const action = nullableString(body.action)
  if (!action) throw createError({ statusCode: 400, message: 'action 不能为空' })
  const sourceApp = nullableString(body.sourceApp) || actor.appCode || 'external'
  if (actor.appCode && sourceApp !== actor.appCode) {
    throw createError({ statusCode: 403, message: 'sourceApp 与服务身份不匹配' })
  }

  const detail = typeof body.detail === 'string'
    ? { detail: body.detail }
    : (body.detail || {})

  return await appendConsoleOperationLog(event, {
    ...body,
    sourceApp,
    detail,
    ipAddress: getAuthRequestIp(event),
    operatorUid: nullableString(body.operatorUid)
      || (body.operatorUserId == null ? null : String(body.operatorUserId)),
    verifiedSourceApp: actor.appCode,
    verifiedActorId: actor.actorId
  })
})
