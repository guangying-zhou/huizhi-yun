import type { H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import {
  requireAimsNotificationDetailAuthorizationResult,
  requireAimsNotificationDetailFinalizeResult,
  type AimsNotificationAuthorizationChallenge,
  type AimsNotificationAuthorizationDecisionBinding
} from './notificationDetailAuthorizationResult'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
}

interface TrustedNotificationActor {
  subjectUid: string
  tenantId: string
  deploymentId: string
}

function unavailable(): never {
  throw createError({ statusCode: 503, message: 'Aims notification authorization is unavailable.' })
}

function notificationId(value: unknown) {
  const normalized = String(value || '').trim()
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.codePointAt(0) || 0
    return code < 32 || code === 127
  })
  if (!normalized || normalized.length > 191 || hasControlCharacter) {
    throw createError({ statusCode: 400, message: 'notificationId is invalid.' })
  }
  return normalized
}

async function callAimsNotificationAuthorizationRuntime(
  event: H3Event,
  actor: TrustedNotificationActor,
  body: Record<string, unknown>
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<unknown>>(
    event,
    '/v1/aims/notification-details/authorize',
    {
      appCode: 'aims',
      scope: 'aims.read',
      method: 'POST',
      body,
      notificationDetailActor: {
        uid: actor.subjectUid,
        tenantId: actor.tenantId,
        deploymentId: actor.deploymentId
      }
    }
  )
  if (!runtime.handled || runtime.data.code !== 0 || !runtime.data.data) unavailable()
  return runtime.data.data
}

export async function authorizeAimsNotificationDetail(
  event: H3Event,
  actor: TrustedNotificationActor,
  descriptor: Record<string, unknown>,
  notificationIdInput: string
) {
  const id = notificationId(notificationIdInput)
  if (descriptor.resource === 'integration_operation') {
    const data = await callAimsNotificationAuthorizationRuntime(event, actor, {
      notificationId: id,
      descriptor
    })
    return requireAimsNotificationDetailAuthorizationResult(data, descriptor)
  }
  const data = await callAimsNotificationAuthorizationRuntime(event, actor, {
    stage: 'prepare',
    notificationId: id,
    descriptor
  })
  return requireAimsNotificationDetailAuthorizationResult(data, descriptor)
}

export async function finalizeAimsNotificationDetailAuthorization(
  event: H3Event,
  actor: TrustedNotificationActor,
  descriptor: Record<string, unknown>,
  notificationIdInput: string,
  challenge: AimsNotificationAuthorizationChallenge,
  decision: AimsNotificationAuthorizationDecisionBinding
) {
  const id = notificationId(notificationIdInput)
  const data = await callAimsNotificationAuthorizationRuntime(event, actor, {
    stage: 'finalize',
    notificationId: id,
    descriptor,
    authorizationChallenge: challenge,
    decisionBinding: decision
  })
  return requireAimsNotificationDetailFinalizeResult(data, descriptor, challenge, decision)
}
