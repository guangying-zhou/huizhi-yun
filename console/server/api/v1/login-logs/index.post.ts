import { appendConsoleLoginLog } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getAuthRequestIp } from '~~/server/utils/authAudit'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

interface LoginLogRequest {
  uid?: string
  identityId?: number
  targetApp?: string
  authProvider?: string
  loginType?: 'password' | 'sso' | 'oauth' | string
  loginResult?: 0 | 1
  failureReason?: string
  sessionId?: string
  ipAddress?: string
  location?: string
  device?: string
  browser?: string
  os?: string
}

export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(event, 'audit', 'audit:write')
  requireIdempotencyKey(event)
  const body = await readBody<LoginLogRequest>(event)
  if (!body.loginType) throw createError({ statusCode: 400, message: 'loginType 不能为空' })
  if (body.loginResult !== 0 && body.loginResult !== 1) {
    throw createError({ statusCode: 400, message: 'loginResult 必须为 0 或 1' })
  }
  const targetApp = body.targetApp || actor.appCode || 'external'
  if (actor.appCode && targetApp !== actor.appCode) {
    throw createError({ statusCode: 403, message: 'targetApp 与服务身份不匹配' })
  }

  return await appendConsoleLoginLog(event, {
    ...body,
    targetApp,
    authProvider: body.authProvider || actor.appCode || 'external',
    ipAddress: body.ipAddress || getAuthRequestIp(event)
  })
})
