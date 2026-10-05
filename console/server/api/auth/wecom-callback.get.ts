import { createError, defineEventHandler, getQuery, sendRedirect } from 'h3'
import { getAuthRequestIp, writeAuthLoginEvent } from '~~/server/utils/authAudit'
import { resolveOrBindDirectoryIdentity } from '~~/server/utils/authIdentity'
import { createConsoleSession, shouldWriteLegacyAuthCookies, writeLegacyAuthCookies } from '~~/server/utils/authSession'
import { redeemWeComBrowserHandoff } from '~~/server/utils/wecom'
import { consumeExternalLoginTransaction } from '~~/server/utils/externalLoginState'
import { resolveConsoleLoginConfig } from '~~/server/utils/loginConfig'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const handoffTicket = typeof q.handoffTicket === 'string' ? q.handoffTicket : ''
  const state = typeof q.state === 'string' ? q.state : ''
  const config = useRuntimeConfig(event)
  const defaultApp = String(config.public?.appCode || config.public?.appName || 'console')
  let targetApp = defaultApp

  if (!state) {
    await writeAuthLoginEvent(event, {
      targetApp,
      authProvider: 'wecom',
      loginType: 'wecom',
      loginResult: 'failed',
      failureReason: 'missing_wecom_callback_parameter',
      ipAddress: getAuthRequestIp(event)
    })
    throw createError({ statusCode: 400, message: '企业微信登录回调无效' })
  }

  try {
    const transaction = await consumeExternalLoginTransaction(event, { provider: 'wecom', state })
    targetApp = transaction.targetApp
    if (!handoffTicket || typeof q.error === 'string') {
      throw createError({ statusCode: 502, message: '企业连接运行时未完成身份交换' })
    }
    const loginConfig = await resolveConsoleLoginConfig(event)
    if (!loginConfig.wecom.enabled) {
      throw createError({ statusCode: 503, message: '企业微信登录未启用' })
    }
    const { userid } = await redeemWeComBrowserHandoff(handoffTicket, event)

    const resolved = await resolveOrBindDirectoryIdentity(event, {
      providerCode: 'wecom',
      providerSubject: userid,
      providerUsername: userid,
      uidCandidates: [userid, userid.toLowerCase()],
      profile: {
        userid
      }
    })
    const session = await createConsoleSession(event, {
      uid: resolved.uid,
      identityId: resolved.identityId,
      authProvider: 'wecom'
    })
    if (shouldWriteLegacyAuthCookies(event)) {
      writeLegacyAuthCookies(event, session.rawSessionId, resolved.user, session.ttlSeconds)
    }

    await writeAuthLoginEvent(event, {
      uid: resolved.uid,
      identityId: resolved.identityId,
      targetApp,
      authProvider: 'wecom',
      loginType: 'wecom',
      loginResult: 'success',
      sessionId: session.storedSessionId,
      ipAddress: getAuthRequestIp(event)
    })

    return sendRedirect(event, transaction.redirect)
  } catch (error: unknown) {
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode) || 500
      : 500
    console.error('[Wecom Callback] Login failed with status:', statusCode)
    await writeAuthLoginEvent(event, {
      targetApp,
      authProvider: 'wecom',
      loginType: 'wecom',
      loginResult: 'failed',
      failureReason: `wecom_callback_failed_${statusCode}`,
      ipAddress: getAuthRequestIp(event)
    })

    throw createError({
      statusCode: [400, 401, 403, 409, 503].includes(statusCode) ? statusCode : 502,
      message: statusCode === 403 ? '企业微信账号未绑定有效企业用户' : '企业微信登录失败，请重试'
    })
  }
})
