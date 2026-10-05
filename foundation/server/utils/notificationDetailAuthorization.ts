import { createError, type H3Event } from 'h3'
import { resolveConsoleAuthContext, type ConsoleAuthRequestContext } from './consoleOidc'

export interface NotificationDetailAuthorizationRequest {
  notificationId: string
  descriptor: Record<string, unknown>
  subject: {
    uid: string
  }
  tenantId: string
  deploymentId: string
}

interface NotificationDetailAuthorizationCallerOptions {
  scope: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function serviceSource(auth: ConsoleAuthRequestContext) {
  return text(auth.appCode) || text(auth.clientCode).replace(/\.runtime$/, '')
}

function serviceScopes(auth: ConsoleAuthRequestContext) {
  const scopes = new Set(auth.scopes || [])
  for (const item of text(auth.claims?.scope).split(/\s+/).filter(Boolean)) scopes.add(item)
  return scopes
}

export function parseNotificationDetailAuthorizationRequest(
  value: unknown
): NotificationDetailAuthorizationRequest {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const descriptor = input.descriptor && typeof input.descriptor === 'object' && !Array.isArray(input.descriptor)
    ? input.descriptor as Record<string, unknown>
    : null
  const subject = input.subject && typeof input.subject === 'object' && !Array.isArray(input.subject)
    ? input.subject as Record<string, unknown>
    : {}
  const uid = text(subject.uid)
  const notificationId = text(input.notificationId)
  const tenantId = text(input.tenantId)
  const deploymentId = text(input.deploymentId)

  if (!notificationId || !descriptor || !uid || !tenantId || !deploymentId) {
    throw createError({
      statusCode: 400,
      message: 'notificationId, descriptor, subject.uid, tenantId and deploymentId are required.'
    })
  }
  const invalidIdentity = (value: string) => [...value].some((character) => {
    const code = character.codePointAt(0) || 0
    return code < 32 || code === 127
  })
  if (uid.length > 191 || invalidIdentity(uid)) {
    throw createError({ statusCode: 400, message: 'subject.uid is invalid.' })
  }
  if (notificationId.length > 191 || invalidIdentity(notificationId)) {
    throw createError({ statusCode: 400, message: 'notificationId is invalid.' })
  }

  return { notificationId, descriptor, subject: { uid }, tenantId, deploymentId }
}

export async function requireNotificationDetailAuthorizationCaller(
  event: H3Event,
  request: NotificationDetailAuthorizationRequest,
  options: NotificationDetailAuthorizationCallerOptions
) {
  const existing = event.context.consoleAuth as ConsoleAuthRequestContext | undefined
  const auth = existing?.authenticated ? existing : await resolveConsoleAuthContext(event)
  event.context.consoleAuth = auth

  if (!auth.authenticated || auth.tokenUse !== 'service' || auth.subjectType !== 'service') {
    throw createError({ statusCode: 401, message: 'Console service token is required.' })
  }
  if (serviceSource(auth) !== 'console') {
    throw createError({ statusCode: 403, message: 'Only Console may authorize notification details.' })
  }
  if (!serviceScopes(auth).has(options.scope)) {
    throw createError({ statusCode: 403, message: `Missing required service scope: ${options.scope}` })
  }

  const tokenTenant = text(auth.tenant)
  const tokenDeployment = text(auth.deployment)
  if (!tokenTenant || tokenTenant !== request.tenantId) {
    throw createError({ statusCode: 403, message: 'Notification tenant does not match the service token.' })
  }
  if (!tokenDeployment || tokenDeployment !== request.deploymentId) {
    throw createError({ statusCode: 403, message: 'Notification deployment does not match the service token.' })
  }

  return {
    sourceApp: 'console' as const,
    tenantId: tokenTenant,
    deploymentId: tokenDeployment,
    subjectUid: request.subject.uid
  }
}
