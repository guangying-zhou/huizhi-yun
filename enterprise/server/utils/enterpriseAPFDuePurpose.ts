import { createError, type H3Event } from 'h3'
import { callEnterpriseNotificationRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeChannels'
import { parseNotificationDetailAuthorizationRequest, requireNotificationDetailAuthorizationCaller } from '@hzy/foundation/server/utils/notificationDetailAuthorization'

const domains = { sales: 'altoc', billing: 'altoc', issuance: 'finance', reconciliation: 'finance', handover: 'people', asset_recovery: 'people' } as const
export async function enterpriseAPFDuePurpose(event: H3Event, body: Record<string, unknown>) {
  const request = parseNotificationDetailAuthorizationRequest(body)
  const actor = await requireNotificationDetailAuthorizationCaller(event, request, { scope: 'enterprise:notification-detail:authorize' })
  const descriptor = request.descriptor
  const match = /^apf-due:(sales-due|billing-due|issuance-due|reconciliation-due|handover-due|asset-recovery-due):[a-z_]+:[1-9][0-9]*:[1-9][0-9]*$/.exec(String(descriptor.id))
  if (Object.keys(descriptor).sort().join(',') !== 'id,resource' || !match?.[1] || descriptor.resource !== (match[1] === 'sales-due' && String(descriptor.id).split(':')[2] === 'lead' ? 'apf_sales_lead_due' : `apf_${match[1].replaceAll('-', '_')}`)) throw createError({ statusCode: 400, message: 'apf_due_descriptor_invalid' })
  const family = match[1]!
  const domain = domains[family.slice(0, -4).replaceAll('-', '_') as keyof typeof domains]
  const result = await callEnterpriseNotificationRuntime<{ code: number, data: { allowed: boolean } }>(event, domain, { uid: actor.subjectUid, tenantId: actor.tenantId, deploymentId: actor.deploymentId }, { eventKey: descriptor.id })
  if (result.code !== 0 || typeof result.data?.allowed !== 'boolean') throw createError({ statusCode: 503, message: 'apf_due_authorization_unavailable' })
  return { code: 0, data: { allowed: result.data.allowed, descriptor } }
}
