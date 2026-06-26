import { createError, defineEventHandler, getQuery, sendRedirect } from 'h3'
import { getAuthRequestIp, writeAuthLoginEvent } from '~~/server/utils/authAudit'
import { resolveOrBindDirectoryIdentity } from '~~/server/utils/authIdentity'
import { createConsoleSession, shouldWriteLegacyAuthCookies, writeLegacyAuthCookies } from '~~/server/utils/authSession'
import { getWecomUserByCode, getWecomUserDetail } from '~~/server/utils/wecom'

function getRedirectParam(value: unknown) {
  const redirect = typeof value === 'string' ? value.trim() : ''
  if (!redirect) return '/'
  if (redirect.startsWith('/') || redirect.startsWith('http://') || redirect.startsWith('https://')) return redirect
  return '/'
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const code = typeof q.code === 'string' ? q.code : ''
  const config = useRuntimeConfig()
  const defaultApp = String(config.public?.appCode || config.public?.appName || 'console')
  const targetApp = typeof q.target_app === 'string' && q.target_app.trim() ? q.target_app.trim() : defaultApp
  const redirect = getRedirectParam(q.redirect)

  if (!code) {
    await writeAuthLoginEvent({
      targetApp,
      authProvider: 'wecom',
      loginType: 'oauth',
      loginResult: 'failed',
      failureReason: 'Missing OAuth code',
      ipAddress: getAuthRequestIp(event)
    })
    throw createError({ statusCode: 400, message: '缺少授权码' })
  }

  try {
    const { userid } = await getWecomUserByCode(code, event)
    const wecomUser = await getWecomUserDetail(userid, event)

    const resolved = await resolveOrBindDirectoryIdentity({
      providerCode: 'wecom',
      providerSubject: userid,
      providerUsername: userid,
      email: wecomUser.email,
      uidCandidates: [userid, userid.toLowerCase()],
      profile: {
        userid,
        email: wecomUser.email
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

    await writeAuthLoginEvent({
      uid: resolved.uid,
      identityId: resolved.identityId,
      targetApp,
      authProvider: 'wecom',
      loginType: 'oauth',
      loginResult: 'success',
      sessionId: session.storedSessionId,
      ipAddress: getAuthRequestIp(event)
    })

    return sendRedirect(event, redirect)
  } catch (error: unknown) {
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode) || 500
      : 500
    const message = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message)
        : 'WeChat Work login failed'

    if (statusCode !== 403) {
      console.error('[Wecom Callback] Error:', message)
    }
    await writeAuthLoginEvent({
      targetApp,
      authProvider: 'wecom',
      loginType: 'oauth',
      loginResult: 'failed',
      failureReason: message,
      sessionId: code,
      ipAddress: getAuthRequestIp(event)
    })

    throw createError({ statusCode, message })
  }
})
