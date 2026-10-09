import { createError, type H3Event } from 'h3'
import { callEnterpriseNotificationRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeChannels'
import { parseNotificationDetailAuthorizationRequest, requireNotificationDetailAuthorizationCaller } from '@hzy/foundation/server/utils/notificationDetailAuthorization'

export async function enterpriseAPFDeadLetterPurpose(event: H3Event, body: Record<string, unknown>) {
  const request = parseNotificationDetailAuthorizationRequest(body)
  const actor = await requireNotificationDetailAuthorizationCaller(event, request, { scope: 'enterprise:notification-detail:authorize' })
  const descriptor = request.descriptor
  const match = /^apf_(altoc|finance|people)_dead_letter$/.exec(String(descriptor.resource))
  if (!match || Object.keys(descriptor).sort().join(',') !== 'id,resource' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(descriptor.id))) throw createError({ statusCode: 400 })
  const result = await callEnterpriseNotificationRuntime<{ code: number, data: { allowed: boolean } }>(event, match[1] as 'altoc' | 'finance' | 'people', { uid: actor.subjectUid, tenantId: actor.tenantId, deploymentId: actor.deploymentId }, { deadLetterOperationId: descriptor.id, notificationId: request.notificationId })
  if (result.code !== 0 || typeof result.data?.allowed !== 'boolean') throw createError({ statusCode: 503 })
  return { code: 0, data: { allowed: result.data.allowed, descriptor } }
}
