import { verifyApiKey } from '~~/server/utils/api-auth'
import { logOperation } from '~~/server/utils/log'

defineRouteMeta({
  openAPI: {
    tags: ['审计日志'],
    summary: '上报操作日志',
    description: '供其他模块统一提交关键操作日志，由 Account 集中写入。需要 API Key 认证。',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['action'],
            properties: {
              action: { type: 'string', description: '操作标识，如 document.create' },
              sourceApp: { type: 'string', description: '来源模块编码（默认 external）' },
              sessionId: { type: 'string' },
              targetType: { type: 'string', description: '目标对象类型' },
              targetId: { type: 'string', description: '目标对象标识' },
              detail: { type: 'object', description: '扩展信息' },
              result: { type: 'string', enum: ['success', 'failed'] },
              operatorUid: { type: 'string' },
              operatorUserId: { type: 'integer' }
            }
          }
        }
      }
    }
  }
})

interface OperationLogRequest {
  sourceApp?: string
  sessionId?: string
  action: string
  targetType?: string
  targetId?: string | number
  detail?: string | Record<string, unknown>
  result?: 'success' | 'failed'
  operatorUid?: string
  operatorUserId?: number
}

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

  const body = await readBody<OperationLogRequest>(event)

  if (!body.action || !String(body.action).trim()) {
    throw createError({
      statusCode: 400,
      message: 'action 不能为空'
    })
  }

  await logOperation({
    userId: body.operatorUserId ?? null,
    uid: body.operatorUid ?? null,
    sourceApp: body.sourceApp || 'external',
    sessionId: body.sessionId || null,
    action: body.action,
    targetType: body.targetType || null,
    targetId: body.targetId ?? null,
    detail: body.detail || null,
    result: body.result || 'success',
    ipAddress: event.node.req.socket.remoteAddress || null
  })

  return {
    code: 0,
    message: 'success',
    data: null
  }
})
