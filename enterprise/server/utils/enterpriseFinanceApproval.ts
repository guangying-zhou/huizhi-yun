import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { callEnterpriseFinanceApprovalWorker } from '@hzy/foundation/server/utils/enterpriseRuntimeChannels'
import { authorizeFinanceLedger, normalizeFinanceLedgerRequest } from './enterpriseFinanceLedger'
import { workflowRequest } from './enterpriseWorkflowProxy'
import { buildAPFPermit } from './enterpriseAPF'

export interface FrozenFinanceApproval {
  resource: 'invoices' | 'expenses'
  action?: 'request' | 'claim' | 'project_expense' | 'payment'
  bizId: string
  actor: string
  title: string
  key: string
  requestNo: string
  expectedVersion: number
  formData: Record<string, unknown>
}
export async function createFinanceApprovalInstance(event: H3Event, request: FrozenFinanceApproval, timeoutMs?: number) {
  const biz = { app_code: 'finance', resource_code: request.resource, action_code: request.action || 'request', biz_id: request.bizId, biz_title: request.title, form_data: request.formData }
  const prepared = await workflowRequest<{ code: number, data: { action_def: { id: number, app_code: string, resource_code: string, action_code: string }, matched_routes: { id: number }[] } }>(event, request.actor, 'instances/prepare', { method: 'POST', body: biz, timeoutMs })
  const def = prepared.data?.action_def
  if (prepared.code !== 0 || def?.app_code !== 'finance' || def.resource_code !== biz.resource_code || def.action_code !== biz.action_code || !Number.isSafeInteger(def.id) || def.id < 1 || !prepared.data.matched_routes?.[0]?.id) throw createError({ statusCode: 503, message: '开票审批流程尚未配置，请沿用同一请求重试' })
  const result = await workflowRequest<{ code: number, data: { instance_id: number, instance_no: string } }>(event, request.actor, 'instances', {
    method: 'POST', key: request.requestNo, timeoutMs,
    body: { action_def_id: def.id, route_id: prepared.data.matched_routes[0].id, biz_id: request.bizId, biz_title: request.title, biz_url: `/finance/${request.resource === 'invoices' ? 'invoices/requests' : request.action === 'claim' ? 'expenses/claims' : request.action === 'payment' ? 'payment-requests' : 'expenses/project-requests'}/${encodeURIComponent(request.bizId)}`, form_data: request.formData, callback_url: '/api/v1/finance/workflow/callback' }
  })
  if (result.code !== 0 || !Number.isSafeInteger(result.data?.instance_id) || result.data.instance_id < 1 || !result.data.instance_no) throw createError({ statusCode: 503, message: '审批创建结果未确认，请沿用同一请求重试' })
  return result.data
}
export async function submitFinanceApproval(event: H3Event, operation: 'invoice-approval-request' | 'claims-submit' | 'project-requests-submit' | 'payment-requests-submit' = 'invoice-approval-request') {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const body = await readBody<Record<string, unknown>>(event)
  const code = getRouterParam(event, 'code') || ''
  if (Object.keys(getQuery(event)).length || !body || Array.isArray(body) || Object.keys(body).some(field => !['expectedVersion', 'recover'].includes(field)) || (Object.hasOwn(body, 'recover') && body.recover !== true) || !Object.hasOwn(body, 'expectedVersion') || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) throw createError({ statusCode: 400 })
  const user = await requireEnterpriseUser(event)
  let key = getHeader(event, 'idempotency-key') || ''
  let expectedVersion = Number(body.expectedVersion)
  const recover = body.recover === true
  const call = async <T>(bind = false, recovery = false) => {
    const target = operation === 'invoice-approval-request' && bind ? 'invoice-approval-bind' : operation
    const finance = normalizeFinanceLedgerRequest(target, code, {}, { expectedVersion, ...(recovery ? { phase: 'recover' } : {}), ...(bind && operation !== 'invoice-approval-request' ? { phase: 'bind' } : {}) })
    const { op, authorization } = await authorizeFinanceLedger(event, target, finance)
    return await callEnterpriseRuntime<{ code: number, data: T }>(event, op, { finance, authorization }, { idempotencyKey: key })
  }
  const frozen = await call<FrozenFinanceApproval>(false, recover)
  const request = frozen.data
  if (frozen.code !== 0 || request?.resource !== (operation === 'invoice-approval-request' ? 'invoices' : 'expenses') || (operation === 'claims-submit' && request.action !== 'claim') || (operation === 'project-requests-submit' && request.action !== 'project_expense') || (operation === 'payment-requests-submit' && request.action !== 'payment') || request.bizId !== code || request.actor !== user.uid || typeof request.key !== 'string' || !request.key || !Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1 || (!recover && (request.key !== key || request.expectedVersion !== expectedVersion)) || (recover && request.expectedVersion + 1 !== expectedVersion) || !request.requestNo?.startsWith('APF-FIN-')) throw createError({ statusCode: 503 })
  // Create/bind always reuse the original server-frozen command.
  key = request.key
  expectedVersion = request.expectedVersion
  try {
    const instance = await createFinanceApprovalInstance(event, request)
    const bound = await call<{ bound: boolean, instanceId: string }>(true)
    if (bound.code !== 0 || bound.data?.bound !== true || bound.data.instanceId !== String(instance.instance_id)) throw createError({ statusCode: 503 })
    return { code: 0, data: { requestNo: request.requestNo, instanceId: bound.data.instanceId, submitted: true } }
  } catch (cause) {
    const error = cause as { statusCode?: number, data?: Record<string, unknown> }
    throw createError({ statusCode: error.statusCode || 503, message: '审批提交结果未确认，请沿用同一请求重试；申请草稿已冻结', data: { ...error.data, requestFrozen: true } })
  }
}
export async function resumeFinanceApprovals(event: H3Event) {
  const pending = await callEnterpriseFinanceApprovalWorker<{ code: number, data: FrozenFinanceApproval[] }>(event, 'pending', {})
  if (pending.code !== 0 || !Array.isArray(pending.data) || pending.data.length > 40) throw createError({ statusCode: 503 })
  let bound = 0
  let deferred = 0
  const deadline = Date.now() + 15000
  for (const request of pending.data.slice(0, 3)) {
    if (Date.now() >= deadline) break
    try {
      await createFinanceApprovalInstance(event, request, Math.max(1, Math.min(3000, deadline - Date.now())))
      const result = await callEnterpriseFinanceApprovalWorker<{ code: number, data: { bound: boolean } }>(event, 'bind', { requestNo: request.requestNo })
      if (result.code !== 0 || result.data?.bound !== true) throw createError({ statusCode: 503 })
      bound++
    } catch { deferred++ }
  }
  return { bound, deferred, remaining: pending.data.length - bound }
}
export async function createFinanceRequestFromAltoc(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const body = await readBody<Record<string, unknown>>(event)
  const contractId = getRouterParam(event, 'contractId') || ''
  const billingScheduleCode = getRouterParam(event, 'scheduleCode') || ''
  if (Object.keys(getQuery(event)).length || !/^[1-9]\d*$/.test(contractId) || !Number.isSafeInteger(Number(contractId)) || !/^[A-Za-z0-9_-]{1,50}$/.test(billingScheduleCode) || !body || Array.isArray(body) || Object.keys(body).some(k => !['expectedVersion', 'scheduleVersion', 'requestedAmount', 'invoiceItem', 'invoiceProfileCode'].includes(k)) || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) throw createError({ statusCode: 400 })
  const user = await requireEnterpriseUser(event)
  const operation = 'invoice-requests-from-altoc'
  const base = { contractId, billingScheduleCode, expectedContractVersion: body.expectedVersion, scheduleVersion: body.scheduleVersion, requestedAmount: body.requestedAmount, invoiceItem: body.invoiceItem, ...(body.invoiceProfileCode ? { invoiceProfileCode: body.invoiceProfileCode } : {}) }
  // Both personnel scopes are independently obtained, never browser facts.
  const finance = normalizeFinanceLedgerRequest(operation, undefined, {}, base)
  const { op, authorization, key } = await authorizeFinanceLedger(event, operation, finance)
  const altoc = await buildAPFPermit(event, 'altoc', 'save', { id: contractId, rowVersion: Number(body.expectedVersion), code: '', name: '', page: 0, pageSize: 0, search: '' }, user, 'contract')
  finance.payload.altocAuthorization = JSON.stringify(altoc)
  const result = await callEnterpriseRuntime<{ code: number, data: { data: Record<string, unknown> } }>(event, op, { finance, authorization }, { idempotencyKey: key })
  if (result.code !== 0 || !result.data?.data) throw createError({ statusCode: 503 })
  return result.data
}
