import type { H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import {
  requireAssetsNotificationAuthorizationDescriptor,
  requireAssetsNotificationDetailAuthorizationResult
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
  throw createError({ statusCode: 503, message: 'Assets notification authorization is unavailable.' })
}

export async function authorizeAssetsNotificationDetail(
  event: H3Event,
  actor: TrustedNotificationActor,
  descriptorInput: Record<string, unknown>,
  notificationId: string
) {
  const descriptor = requireAssetsNotificationAuthorizationDescriptor(descriptorInput)
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<unknown>>(
    event,
    '/v1/assets/notification-details/authorize',
    {
      appCode: 'assets',
      scope: 'assets.read',
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
  return requireAssetsNotificationDetailAuthorizationResult(runtime.data.data, descriptor)
}
