import { createError } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireServiceScope } from '~~/server/utils/serviceAuth'
import { runtimeEnvelopeError } from '~~/server/utils/aimsRuntimeForward'

export default defineEventHandler(async (event) => {
  await requireServiceScope(event, { scope: 'workflow:callback', allowedApps: ['workflow'] })
  const raw = await readBody<Record<string, unknown>>(event)
  if (!raw || Array.isArray(raw)) throw createError({ statusCode: 400, message: '完成审批回执无效' })
  const body = Object.fromEntries(['event', 'instance_id', 'instance_no', 'app_code', 'resource_code', 'action_code', 'biz_id', 'status', 'initiator_uid', 'form_data', 'approval_actor_uids', 'non_self_approval_actor_uids', 'approval_operator_uid', 'cancellation_actor_uid', 'idempotencyKey'].map(key => [key, raw[key]]))
  const runtime = await maybeCallTenantRuntime<{ code?: number, data?: Record<string, unknown> }>(event, '/v1/aims/service/work-item-completion/workflow-callback', {
    appCode: 'aims', scope: 'aims:work-item-completion-callback:execute', capabilityFormat: 'business',
    serviceTokenSourceBinding: 'service-client-policy', method: 'POST', query: { workflow_callback_verified: '1' }, body
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '完成审批 Runtime 暂不可用' })
  if (runtime.data.code !== undefined && runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return { code: 0, data: runtime.data.data }
})
