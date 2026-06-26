import { getAuthRequestIp } from '~~/server/utils/authAudit'
import { execute } from '~~/server/utils/db'
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

  await execute(
    `INSERT INTO operation_logs (
       domain_code, action, target_type, target_key, actor_type, actor_id, request_id, detail_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), NOW())`,
    [
      sourceApp,
      action,
      nullableString(body.targetType) || 'unknown',
      body.targetId == null ? null : String(body.targetId),
      body.operatorUid || body.operatorUserId ? 'human' : 'service',
      nullableString(body.operatorUid) || (body.operatorUserId == null ? actor.actorId : String(body.operatorUserId)),
      nullableString(body.sessionId),
      JSON.stringify({
        ...detail,
        result: body.result || 'success',
        ipAddress: getAuthRequestIp(event)
      })
    ]
  )

  return { code: 0, message: 'success', data: null }
})
