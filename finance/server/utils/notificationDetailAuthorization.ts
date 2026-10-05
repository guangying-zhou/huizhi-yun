import { createError, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireFinanceNotificationAuthorizationResult, requireFinanceNotificationDescriptor } from './notificationDetailAuthorizationResult'

interface RuntimeEnvelope<T> { code?: number, data?: T }
export async function authorizeFinanceNotificationDetail(event: H3Event, actor: { subjectUid: string, tenantId: string, deploymentId: string }, descriptorInput: Record<string, unknown>, notificationId: string) {
  const descriptor = requireFinanceNotificationDescriptor(descriptorInput)
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<unknown>>(event, '/v1/finance/notification-details/authorize', {
    appCode: 'finance',
    scope: 'finance.read',
    method: 'POST',
    body: { notificationId, descriptor },
    notificationDetailActor: { uid: actor.subjectUid, tenantId: actor.tenantId, deploymentId: actor.deploymentId }
  })
  if (!runtime.handled || runtime.data.code !== 0 || !runtime.data.data) throw createError({ statusCode: 503, message: 'Finance notification authorization is unavailable.' })
  return requireFinanceNotificationAuthorizationResult(runtime.data.data, descriptor)
}
