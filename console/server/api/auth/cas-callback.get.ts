import { defineEventHandler, getQuery, sendRedirect, createError } from 'h3'
import { deriveCasCallbackUrl } from '@hzy/foundation/server/utils/appUrls'
import { fetchExternal } from '@hzy/foundation/server/utils/externalFetch'
import { getAuthRequestIp, writeAuthLoginEvent } from '~~/server/utils/authAudit'
import { resolveOrBindDirectoryIdentity } from '~~/server/utils/authIdentity'
import { createConsoleSession, shouldWriteLegacyAuthCookies, writeLegacyAuthCookies } from '~~/server/utils/authSession'
import { normalizeConsoleAuthReturnRedirect } from '~~/server/utils/authReturnRedirect'
import { resolveConsoleLoginConfig } from '~~/server/utils/loginConfig'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const ticket = typeof q.ticket === 'string' ? q.ticket : (Array.isArray(q.ticket) ? q.ticket[0] : '')

  if (!ticket) {
    throw createError({ statusCode: 400, message: 'Missing ticket' })
  }

  const config = useRuntimeConfig(event)
  const defaultApp = String(config.public?.appCode || config.public?.appName || 'console')
  const targetApp = typeof q.target_app === 'string' && q.target_app.trim() ? q.target_app.trim() : defaultApp
  const redirect = normalizeConsoleAuthReturnRedirect(q.redirect)
  const loginConfig = await resolveConsoleLoginConfig(event)
  const casBaseUrl = loginConfig.cas.baseUrl || (config.public?.casBaseUrl as string) || ''
  if (!loginConfig.cas.enabled || !casBaseUrl) {
    throw createError({ statusCode: 503, message: 'CAS 登录未启用' })
  }

  const callbackQuery = new URLSearchParams({ target_app: targetApp })
  if (redirect !== '/') callbackQuery.set('redirect', redirect)
  const serviceUrl = deriveCasCallbackUrl(event, callbackQuery)

  const validateUrl = `${casBaseUrl.replace(/\/$/, '')}/cas/p3/serviceValidate?service=${encodeURIComponent(serviceUrl)}&ticket=${encodeURIComponent(ticket)}`

  const xml = await fetchExternal<string>(validateUrl, { responseType: 'text' })

  if (!xml.includes('<cas:authenticationSuccess')) {
    await writeAuthLoginEvent(event, {
      targetApp,
      authProvider: 'cas',
      loginType: 'sso',
      loginResult: 'failed',
      failureReason: 'CAS validation failed',
      sessionId: ticket,
      ipAddress: getAuthRequestIp(event)
    })
    throw createError({ statusCode: 401, message: 'CAS validation failed' })
  }

  const userMatch = xml.match(/<cas:user>([^<]+)<\/cas:user>/)
  const uid = (userMatch?.[1] || '').trim()

  if (!uid) {
    throw createError({ statusCode: 401, message: 'No uid in CAS response' })
  }

  const mMail = xml.match(/<cas:mail>([^<]+)<\/cas:mail>/) || xml.match(/<cas:email>([^<]+)<\/cas:email>/)
  const email = mMail && mMail[1] ? mMail[1] : ''

  let resolved: Awaited<ReturnType<typeof resolveOrBindDirectoryIdentity>>
  let session: Awaited<ReturnType<typeof createConsoleSession>>
  try {
    resolved = await resolveOrBindDirectoryIdentity(event, {
      providerCode: 'cas',
      providerSubject: uid,
      providerUsername: uid,
      email,
      uidCandidates: [uid],
      profile: { email }
    })
    session = await createConsoleSession(event, {
      uid: resolved.uid,
      identityId: resolved.identityId,
      authProvider: 'cas'
    })
    if (shouldWriteLegacyAuthCookies(event)) {
      writeLegacyAuthCookies(event, session.rawSessionId, resolved.user, session.ttlSeconds)
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    await writeAuthLoginEvent(event, {
      uid,
      targetApp,
      authProvider: 'cas',
      loginType: 'sso',
      loginResult: 'failed',
      failureReason: message,
      sessionId: ticket,
      ipAddress: getAuthRequestIp(event)
    })
    throw error
  }

  await writeAuthLoginEvent(event, {
    uid: resolved.uid,
    identityId: resolved.identityId,
    targetApp,
    authProvider: 'cas',
    loginType: 'sso',
    loginResult: 'success',
    sessionId: session.storedSessionId,
    ipAddress: getAuthRequestIp(event)
  })

  return sendRedirect(event, redirect)
})
