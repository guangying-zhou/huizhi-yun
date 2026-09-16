import { createError, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import {
  requirePeopleNotificationAuthorizationDescriptor,
  requirePeopleNotificationDetailAuthorizationResult
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
  throw createError({ statusCode: 503, message: 'People notification authorization is unavailable.' })
}

export async function authorizePeopleNotificationDetail(
  event: H3Event,
  actor: TrustedNotificationActor,
  descriptorInput: Record<string, unknown>,
  notificationId: string
) {
  const descriptor = requirePeopleNotificationAuthorizationDescriptor(descriptorInput)
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<unknown>>(
    event,
    '/v1/people/notification-details/authorize',
    {
      appCode: 'people',
      scope: 'people.read',
      method: 'POST',
      body: { notificationId, descriptor },
      notificationDetailActor: {
        uid: actor.subjectUid,
        tenantId: actor.tenantId,
        deploymentId: actor.deploymentId
      }
    }
  )
  if (!runtime.handled || runtime.data.code !== 0 || !runtime.data.data) unavailable()
  return requirePeopleNotificationDetailAuthorizationResult(runtime.data.data, descriptor)
}
