import { getAuthRequestIp, writeAuthLoginEvent } from '~~/server/utils/authAudit'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

interface LoginLogRequest {
  uid?: string
  targetApp?: string
  loginType?: 'password' | 'sso' | 'oauth' | string
  loginResult?: 0 | 1
  failureReason?: string
  sessionId?: string
  ipAddress?: string
  device?: string
  browser?: string
  os?: string
}

export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(event, 'audit', 'audit:write')
  const body = await readBody<LoginLogRequest>(event)
  if (!body.loginType) throw createError({ statusCode: 400, message: 'loginType 不能为空' })
  if (body.loginResult !== 0 && body.loginResult !== 1) {
    throw createError({ statusCode: 400, message: 'loginResult 必须为 0 或 1' })
  }
  const targetApp = body.targetApp || actor.appCode || 'external'
  if (actor.appCode && targetApp !== actor.appCode) {
    throw createError({ statusCode: 403, message: 'targetApp 与服务身份不匹配' })
  }

  await writeAuthLoginEvent({
    uid: body.uid || null,
    targetApp,
    authProvider: 'compat',
    loginType: body.loginType || 'sso',
    loginResult: body.loginResult === 1 ? 'success' : 'failed',
    failureReason: body.failureReason || null,
    sessionId: body.sessionId || null,
    ipAddress: body.ipAddress || getAuthRequestIp(event),
    deviceSummary: body.device || null,
    browser: body.browser || null,
    os: body.os || null
  })

  return { code: 0, message: 'success', data: null }
})
