import { createError, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireAltocNotificationAuthorizationResult, requireAltocNotificationDescriptor } from './receivableNotificationDetailResult'

export async function authorizeAltocReceivableNotification(event: H3Event, actor: { subjectUid: string, tenantId: string, deploymentId: string }, input: Record<string, unknown>, notificationId: string) {
  const descriptor = requireAltocNotificationDescriptor(input)
  const runtime = await maybeCallTenantRuntime<{ code?: number, data?: unknown }>(event, '/v1/altoc/notification-details/authorize', {
    appCode: 'altoc', scope: 'altoc.read', method: 'POST', body: { notificationId, descriptor },
    notificationDetailActor: { uid: actor.subjectUid, tenantId: actor.tenantId, deploymentId: actor.deploymentId }
  })
  if (!runtime.handled || runtime.data.code !== 0 || !runtime.data.data) throw createError({ statusCode: 503, message: 'Altoc notification authorization is unavailable.' })
  return requireAltocNotificationAuthorizationResult(runtime.data.data, descriptor)
}
