import { owningCreateError as createError, type OwningH3Event as H3Event } from '@hzy/foundation/server/utils/owningModuleHttp'
import { callEnterpriseSystemRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeChannels'

const callbackFields = new Set(['event', 'instance_id', 'instance_no', 'app_code', 'resource_code', 'action_code', 'biz_id', 'status', 'initiator_uid', 'form_data', 'approval_actor_uids', 'non_self_approval_actor_uids', 'approval_operator_uid', 'cancellation_actor_uid', 'idempotencyKey'])
export async function receiveWorkflowCallback(event: H3Event, kind: 'standard' | 'completion', input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw createError({ statusCode: 400, message: 'Workflow callback is invalid.' })
  const body = input as Record<string, unknown>
  if (body.app_code !== 'aims') throw createError({ statusCode: 403, message: 'Workflow callback application is invalid.' })
  if (Object.keys(body).some(key => !callbackFields.has(key))) throw createError({ statusCode: 400, message: 'Workflow callback fields are invalid.' })
  if (kind === 'standard' && body.resource_code === 'milestones' && body.action_code === 'milestone_completion' && (useRuntimeConfig(event) as unknown as { hzy?: { enterprise?: { enableMilestoneReceivable?: boolean } } }).hzy?.enterprise?.enableMilestoneReceivable === true) {
    throw createError({ statusCode: 503, message: 'Milestone receivable coordination is disabled in this lane.', data: { code: 'aims_milestone_receivable_lane_disabled' } })
  }
  return await callEnterpriseSystemRuntime(event, kind === 'completion' ? 'aims.completion-callback' : 'aims.workflow-callback', body)
}
