import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { callEnterpriseSystemRuntime, callEnterprisePeopleApprovalWorker } from '@hzy/foundation/server/utils/enterpriseRuntimeChannels'
import { executePeopleFacts, normalizePeopleFacts } from './enterprisePeopleFacts'
import { workflowRequest } from './enterpriseWorkflowProxy'

// No browser-provided instance/result is accepted. Preparation is an ordinary
// versioned owning command; creation is the already-enabled Host Workflow lane.
export async function enterprisePeopleAssignmentSubmit(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const raw = await readBody<Record<string, unknown>>(event)
  if (!raw || Array.isArray(raw) || Object.keys(raw).some(k => !['employeeUid', 'expectedVersion'].includes(k)) || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const key = getHeader(event, 'Idempotency-Key')
  if (!key || !/^[A-Za-z0-9._:-]{1,80}$/.test(key)) throw createError({ statusCode: 400 })
  const user = await requireEnterpriseUser(event)
  const id = getRouterParam(event, 'id') || ''
  const facts = normalizePeopleFacts('assignments-request-workflow', id, raw)
  const prepared = await executePeopleFacts(event, 'assignments-request-workflow', facts, key)
  const frozen = prepared.data.data
  if (frozen.approval_status === 'pending' && frozen.workflow_instance_id) return publicAssignmentResult(prepared)
  const form = frozen.formData as Record<string, unknown>
  if (!form || form.requestedBy !== user.uid || String(form.id) !== id || form.employee_uid !== facts.employeeUid || !/^[a-f0-9]{64}$/.test(String(frozen.snapshotHash)) || !frozen.assignment_code) throw createError({ statusCode: 503 })
  const formData = { ...form, snapshotHash: frozen.snapshotHash }
  const biz = { app_code: 'people', resource_code: 'assignments', action_code: 'change', biz_id: String(frozen.assignment_code), biz_title: '任职变更审批', form_data: formData }
  const plan = await workflowRequest<{ code: number, data: { action_def: { id: number }, matched_routes: { id: number }[] } }>(event, user.uid, 'instances/prepare', { method: 'POST', body: biz })
  if (plan.code !== 0 || !plan.data?.action_def?.id || !plan.data.matched_routes?.[0]?.id) throw createError({ statusCode: 503, message: '任职审批流程尚未配置，请用同一请求重试' })
  const created = await workflowRequest<{ code: number, data: { instance_id: number } }>(event, user.uid, 'instances', { method: 'POST', key: `people:assignment:${id}:${key}`, body: { action_def_id: plan.data.action_def.id, route_id: plan.data.matched_routes[0].id, biz_id: biz.biz_id, biz_title: biz.biz_title, biz_url: `/people/assignments/${id}`, form_data: formData, callback_url: '/api/v1/service/workflow/callback' } })
  if (created.code !== 0 || !Number.isSafeInteger(created.data?.instance_id) || created.data.instance_id < 1) throw createError({ statusCode: 503 })
  return publicAssignmentResult(await executePeopleFacts(event, 'assignments-attach-workflow', normalizePeopleFacts('assignments-attach-workflow', id, { employeeUid: facts.employeeUid, expectedVersion: Number(frozen.row_version), workflowInstanceId: String(created.data.instance_id) }), `${key}:bind`))
}
export async function receiveEnterprisePeopleWorkflow(event: H3Event, raw: Record<string, unknown>) {
  if (raw.app_code !== 'people') throw createError({ statusCode: 403 })
  const resource = raw.biz_type ?? raw.resource_code
  if (!['assignment', 'assignments', 'people_assignment'].includes(String(resource))) throw createError({ statusCode: 403, message: '该 People 审批类型尚未迁入' })
  const body = { app_code: 'people', biz_type: 'assignments', biz_id: String(raw.biz_id || ''), workflow_instance_id: String(raw.workflow_instance_id || raw.instance_id || ''), status: String(raw.status || '') }
  if (!body.biz_id || !/^[1-9]\d*$/.test(body.workflow_instance_id) || !['approved', 'rejected', 'cancelled'].includes(body.status)) throw createError({ statusCode: 400 })
  return await callEnterpriseSystemRuntime(event, 'people.workflow-callback', body)
}

function publicAssignmentResult(result: Awaited<ReturnType<typeof executePeopleFacts>>) {
  const row = result.data.data
  return { code: 0, data: { data: Object.fromEntries(['id', 'row_version', 'assignment_code', 'approval_status', 'workflow_instance_id'].filter(k => k in row).map(k => [k, row[k]])), receiptId: result.data.receiptId } }
}

interface FrozenPeopleApproval {
  id: string
  employeeUid: string
  actor: string
  bizId: string
  key: string
  operationKey: string
  expectedVersion: number
  snapshotHash: string
  formData: Record<string, unknown>
}
export async function resumePeopleAssignmentApprovals(event: H3Event) {
  const pending = await callEnterprisePeopleApprovalWorker<{ code: number, data: FrozenPeopleApproval[] }>(event, 'pending', {})
  if (pending.code !== 0 || !Array.isArray(pending.data) || pending.data.length > 20) throw createError({ statusCode: 503 })
  let resumed = 0
  const deadline = Date.now() + 15000
  for (const f of pending.data.slice(0, 3)) {
    if (Date.now() >= deadline) break
    if (!f.actor || f.formData?.requestedBy !== f.actor || f.formData?.snapshotHash !== f.snapshotHash || String(f.formData?.id) !== f.id || f.formData?.employee_uid !== f.employeeUid || !f.key?.startsWith(`people:assignment:${f.id}:`) || f.key !== f.operationKey) throw createError({ statusCode: 503 })
    const biz = { app_code: 'people', resource_code: 'assignments', action_code: 'change', biz_id: f.bizId, biz_title: '任职变更审批', form_data: f.formData }
    const plan = await workflowRequest<{ code: number, data: { action_def: { id: number, app_code: string, resource_code: string, action_code: string }, matched_routes: { id: number }[] } }>(event, f.actor, 'instances/prepare', { method: 'POST', body: biz, timeoutMs: Math.max(1, Math.min(3000, deadline - Date.now())) })
    const def = plan.data?.action_def
    if (plan.code !== 0 || def?.app_code !== 'people' || def.resource_code !== 'assignments' || def.action_code !== 'change' || !def.id || !plan.data.matched_routes?.[0]?.id) throw createError({ statusCode: 503 })
    const created = await workflowRequest<{ code: number, data: { instance_id: number } }>(event, f.actor, 'instances', { method: 'POST', key: f.key, timeoutMs: Math.max(1, Math.min(3000, deadline - Date.now())), body: { action_def_id: def.id, route_id: plan.data.matched_routes[0].id, biz_id: f.bizId, biz_title: biz.biz_title, biz_url: `/people/assignments/${f.id}`, form_data: f.formData, callback_url: '/api/v1/service/workflow/callback' } })
    if (created.code !== 0 || !Number.isSafeInteger(created.data?.instance_id) || created.data.instance_id < 1) throw createError({ statusCode: 503 })
    const bound = await callEnterprisePeopleApprovalWorker<{ code: number, data: { bound: boolean, instanceId: string } }>(event, 'bind', { operationKey: f.operationKey, workflowInstanceId: String(created.data.instance_id) })
    if (bound.code !== 0 || bound.data?.bound !== true || bound.data.instanceId !== String(created.data.instance_id)) throw createError({ statusCode: 503 })
    resumed++
  }
  return { resumed, remaining: pending.data.length - resumed }
}

// A user recovery does not enter scheduler-inspect or the Directory drain.
export async function enterprisePeopleAssignmentRecover(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const raw = await readBody<Record<string, unknown>>(event)
  if (!raw || Array.isArray(raw) || Object.keys(raw).some(k => !['employeeUid', 'expectedVersion'].includes(k)) || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400 })
  const user = await requireEnterpriseUser(event)
  const id = getRouterParam(event, 'id') || ''
  const key = getHeader(event, 'Idempotency-Key')
  const facts = normalizePeopleFacts('assignments-request-workflow', id, { ...raw, phase: 'recover' })
  const prepared = await executePeopleFacts(event, 'assignments-request-workflow', facts, key)
  const row = prepared.data.data
  if (row.approval_status === 'pending' && row.workflow_instance_id) return publicAssignmentResult(prepared)
  const f = row.frozenApproval as unknown as FrozenPeopleApproval
  if (!f || f.actor !== user.uid || f.id !== id || f.employeeUid !== facts.employeeUid || f.expectedVersion !== Number(raw.expectedVersion) || f.formData?.requestedBy !== user.uid || f.formData?.snapshotHash !== f.snapshotHash || String(f.formData?.id) !== id || f.formData?.employee_uid !== f.employeeUid || !f.bizId || !/^[a-f0-9]{64}$/.test(f.snapshotHash) || !f.key?.startsWith(`people:assignment:${id}:`) || f.key !== f.operationKey) throw createError({ statusCode: 503 })
  const biz = { app_code: 'people', resource_code: 'assignments', action_code: 'change', biz_id: f.bizId, biz_title: '任职变更审批', form_data: f.formData }
  const plan = await workflowRequest<{ code: number, data: { action_def: { id: number, app_code: string, resource_code: string, action_code: string }, matched_routes: { id: number }[] } }>(event, f.actor, 'instances/prepare', { method: 'POST', body: biz })
  const def = plan.data?.action_def
  if (plan.code !== 0 || def?.app_code !== 'people' || def.resource_code !== 'assignments' || def.action_code !== 'change' || !def.id || !plan.data.matched_routes?.[0]?.id) throw createError({ statusCode: 503 })
  const created = await workflowRequest<{ code: number, data: { instance_id: number } }>(event, f.actor, 'instances', { method: 'POST', key: f.operationKey, body: { action_def_id: def.id, route_id: plan.data.matched_routes[0].id, biz_id: f.bizId, biz_title: biz.biz_title, biz_url: `/people/assignments/${id}`, form_data: f.formData, callback_url: '/api/v1/service/workflow/callback' } })
  if (created.code !== 0 || !Number.isSafeInteger(created.data?.instance_id) || created.data.instance_id < 1) throw createError({ statusCode: 503 })
  // A stable bind intent shared with the original submission (no browser key).
  const originalKey = f.operationKey.slice(`people:assignment:${id}:`.length)
  return publicAssignmentResult(await executePeopleFacts(event, 'assignments-attach-workflow', normalizePeopleFacts('assignments-attach-workflow', id, { employeeUid: f.employeeUid, expectedVersion: f.expectedVersion, workflowInstanceId: String(created.data.instance_id) }), `${originalKey}:bind`))
}
