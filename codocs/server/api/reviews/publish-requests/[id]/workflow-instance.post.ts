/**
 * 绑定 Workflow 实例到发布申请
 * POST /api/reviews/publish-requests/:id/workflow-instance
 */
import { getRouterParam } from 'h3'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestWithServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { buildServiceCommandEnvelope, validateServiceCommandReceipt } from '@hzy/foundation/server/utils/serviceOperation'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

type Row = Record<string, unknown>

function text(value: unknown) {
  return String(value || '').trim()
}

function runtimeInstance(result: unknown) {
  const row = result && typeof result === 'object' ? result as Row : {}
  const instance = row.instance && typeof row.instance === 'object' ? row.instance as Row : {}
  return { id: Number(instance.instance_id || 0), no: text(instance.instance_no) }
}

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  await requirePermission(event, 'reviews', 'submit', '缺少审阅提交权限')
  const requestId = text(getRouterParam(event, 'id'))
  if (!/^\d+$/.test(requestId)) throw createError({ statusCode: 400, message: '发布申请 ID 无效' })
  const prepared = await callCodocsTenantRuntime<Row>(event, `/v1/codocs/reviews/publish-requests/${encodeURIComponent(requestId)}/workflow-command`, {
    method: 'POST', scope: 'codocs.write', body: { current_user: uid }
  })
  if (prepared.bound) return { code: 0, data: { workflowInstanceId: prepared.workflowInstanceId, workflowInstanceNo: prepared.workflowInstanceNo, workflowStatus: prepared.workflowStatus, idempotent: true } }
  const operation = prepared.serviceCommand as Row | undefined
  if (!operation) throw createError({ statusCode: 503, message: 'Publish request Workflow command is unavailable.' })
  const baseUrl = resolveServiceAppBaseUrl(event, 'workflow', { directTarget: true })
  if (!baseUrl) throw createError({ statusCode: 503, message: 'Workflow service API base URL is not configured.' })
  const response = await requestWithServiceAccessToken<Row>({
    audience: 'workflow', scope: 'workflow:document-publish:create', event,
    request: async token => await serviceAppFetch<Row>(event, 'workflow', `${baseUrl.replace(/\/$/, '')}/api/v1/service/codocs-publish-approval`, {
      method: 'POST', headers: { ...trustedServiceRequestHeaders(event, 'workflow'), 'authorization': `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': text(operation.idempotencyKey), 'x-hzy-actor-uid': uid }, body: buildServiceCommandEnvelope(operation as never)
    })
  })
  const receiptData = response.data as Row | undefined
  const target = runtimeInstance(receiptData?.result)
  if (!target.id || !target.no) throw createError({ statusCode: 502, message: 'Workflow receipt instance identity is invalid.' })
  const receipt = validateServiceCommandReceipt(operation as never, receiptData, { targetBizType: 'workflow_instance', targetBizCode: target.no })
  const checkpoint = await callCodocsTenantRuntime<Row>(event, `/v1/codocs/reviews/publish-requests/${encodeURIComponent(requestId)}/workflow-checkpoint`, {
    method: 'POST', scope: 'codocs.write', body: { current_user: uid, workflowInstanceId: target.id, workflowInstanceNo: target.no, ...receipt }
  })
  return { code: 0, data: { ...checkpoint, receipt: { idempotent: receipt.idempotent } } }
})
