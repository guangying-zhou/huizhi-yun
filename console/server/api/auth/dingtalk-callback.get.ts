import { createError, defineEventHandler, getQuery, sendRedirect } from 'h3'
import { getAuthRequestIp, writeAuthLoginEvent } from '~~/server/utils/authAudit'
import { resolveOrBindDirectoryIdentity } from '~~/server/utils/authIdentity'
import { createConsoleSession, shouldWriteLegacyAuthCookies, writeLegacyAuthCookies } from '~~/server/utils/authSession'
import { getDingTalkUserByCode } from '~~/server/utils/dingtalk'
import { consumeExternalLoginTransaction } from '~~/server/utils/externalLoginState'
import { resolveConsoleLoginConfig } from '~~/server/utils/loginConfig'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const code = typeof query.authCode === 'string' ? query.authCode : typeof query.code === 'string' ? query.code : ''
  const state = typeof query.state === 'string' ? query.state : ''
  const runtime = useRuntimeConfig(event)
  const defaultApp = String(runtime.public?.appCode || runtime.public?.appName || 'console')
  let targetApp = defaultApp
  if (!code || !state) {
    throw createError({ statusCode: 400, message: '钉钉登录回调无效' })
  }
  try {
    const transaction = await consumeExternalLoginTransaction(event, { provider: 'dingtalk', state })
    targetApp = transaction.targetApp
    const loginConfig = await resolveConsoleLoginConfig(event)
    if (!loginConfig.dingtalk.enabled) {
      throw createError({ statusCode: 503, message: '钉钉登录未启用' })
    }
    const { userid } = await getDingTalkUserByCode(code, event, transaction.integrationCode)
    const resolved = await resolveOrBindDirectoryIdentity(event, {
      providerCode: 'dingtalk', providerSubject: userid, providerUsername: userid,
      uidCandidates: [userid, userid.toLowerCase()], profile: { userid }
    })
    const session = await createConsoleSession(event, { uid: resolved.uid, identityId: resolved.identityId, authProvider: 'dingtalk' })
    if (shouldWriteLegacyAuthCookies(event)) writeLegacyAuthCookies(event, session.rawSessionId, resolved.user, session.ttlSeconds)
    await writeAuthLoginEvent(event, {
      uid: resolved.uid, identityId: resolved.identityId, targetApp, authProvider: 'dingtalk', loginType: 'dingtalk',
      loginResult: 'success', sessionId: session.storedSessionId, ipAddress: getAuthRequestIp(event)
    })
    return sendRedirect(event, transaction.redirect)
  } catch (error: unknown) {
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode) || 500
      : 500
    const projectedCode = typeof error === 'object' && error !== null && 'data' in error
      ? String((error as { data?: { code?: unknown } }).data?.code || '').trim()
      : ''
    const safeFailureCode = /^dingtalk_[a-z0-9_]{1,96}$/.test(projectedCode)
      ? projectedCode
      : `dingtalk_callback_failed_${statusCode}`
    console.error('[DingTalk Callback] Login failed:', safeFailureCode)
    await writeAuthLoginEvent(event, {
      targetApp, authProvider: 'dingtalk', loginType: 'dingtalk', loginResult: 'failed',
      failureReason: safeFailureCode, ipAddress: getAuthRequestIp(event)
    })
    const projectedMessage = projectedCode && typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message || '').trim()
      : ''
    throw createError({
      statusCode: [400, 401, 403, 409, 503].includes(statusCode) ? statusCode : 502,
      message: projectedMessage || (statusCode === 403 ? '钉钉账号未绑定有效企业用户' : '钉钉登录失败，请重试')
    })
  }
})
