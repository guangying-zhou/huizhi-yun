import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { callEnterpriseAltocApprovalWorker } from '@hzy/foundation/server/utils/enterpriseRuntimeChannels'
import { buildAPFPermit } from './enterpriseAPF'
import { workflowRequest } from './enterpriseWorkflowProxy'

interface FrozenApproval {
  resource: 'quotation' | 'contract'
  bizId: string
  actor: string
  title: string
  key: string
  requestNo: string
  expectedVersion: number
  formData: Record<string, unknown>
}
export async function createAltocApprovalInstance(event: H3Event, request: FrozenApproval, timeoutMs?: number) {
  const biz = { app_code: 'altoc', resource_code: request.resource, action_code: 'approve', biz_id: request.bizId, biz_title: request.title, form_data: request.formData }
  const prepared = await workflowRequest<{ code: number, data: { action_def: { id: number, app_code: string, resource_code: string, action_code: string }, matched_routes: { id: number }[] } }>(event, request.actor, 'instances/prepare', { method: 'POST', body: biz, timeoutMs })
  const def = prepared.data?.action_def
  if (prepared.code !== 0 || def?.app_code !== 'altoc' || def.resource_code !== request.resource || def.action_code !== 'approve' || !def.id || !prepared.data.matched_routes?.[0]?.id) throw createError({ statusCode: 503, message: '审批流程尚未配置，请稍后按同一请求重试' })
  const result = await workflowRequest<{ code: number, data: { instance_id: number, instance_no: string } }>(event, request.actor, 'instances', {
    method: 'POST', key: request.requestNo, timeoutMs,
    body: { action_def_id: def.id, route_id: prepared.data.matched_routes[0].id, biz_id: request.bizId, biz_title: request.title, biz_url: `/altoc/${request.resource === 'quotation' ? 'quotes' : 'contracts'}/${request.bizId}`, form_data: request.formData, callback_url: '/api/v1/service/workflow/callback' }
  })
  if (result.code !== 0 || !Number.isSafeInteger(result.data?.instance_id) || result.data.instance_id <= 0 || !result.data.instance_no) throw createError({ statusCode: 503, message: '审批创建结果未确认，请按同一请求重试' })
  return result.data
}
export async function submitAltocApproval(event: H3Event, resource: 'quotation' | 'contract', id: string, expectedVersion: unknown) {
  const key = getHeader(event, 'idempotency-key') || ''
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(key) || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || !Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) throw createError({ statusCode: 400 })
  const user = await requireEnterpriseUser(event)
  const input = { id, rowVersion: Number(expectedVersion), code: '', name: '', page: 0, pageSize: 0, search: '' }
  const call = async <T>(action: 'request' | 'bind') => {
    const operation = `${resource}-approval-${action}` as const
    const op = `altoc.${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
    await prepareEnterpriseRuntime(event, op)
    const authorization = { ...await buildAPFPermit(event, 'altoc', 'save', input, user, resource), operation }
    return await callEnterpriseRuntime<{ code: number, data: T }>(event, op, { ...input, authorization }, { idempotencyKey: key })
  }
  const frozen = await call<FrozenApproval>('request')
  const request = frozen.data
  if (frozen.code !== 0 || request?.resource !== resource || request.bizId !== id || request.actor !== user.uid || request.key !== key || request.expectedVersion !== input.rowVersion || !request.requestNo?.startsWith('APF-')) throw createError({ statusCode: 503 })
  try {
    const instance = await createAltocApprovalInstance(event, request)
    const bound = await call<{ bound: boolean, instanceId: string }>('bind')
    if (bound.code !== 0 || bound.data?.bound !== true || bound.data.instanceId !== String(instance.instance_id)) throw createError({ statusCode: 503 })
    return { code: 0, data: { requestNo: request.requestNo, instanceId: bound.data.instanceId, submitted: true } }
  } catch (cause) {
    const error = cause as { statusCode?: number, message?: string, data?: Record<string, unknown> }
    throw createError({ statusCode: error.statusCode || 503, message: error.message || '审批提交结果未确认，请沿用同一请求重试', data: { ...error.data, requestFrozen: true } })
  }
}
export async function enterpriseAltocContractSubmit(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const body = await readBody<Record<string, unknown>>(event)
  if (Object.keys(getQuery(event)).length || !body || Array.isArray(body) || Object.keys(body).some(key => key !== 'expectedVersion')) throw createError({ statusCode: 400 })
  return await submitAltocApproval(event, 'contract', getRouterParam(event, 'contractId') || '', body.expectedVersion)
}
export async function resumeAltocApprovals(event: H3Event) {
  const pending = await callEnterpriseAltocApprovalWorker<{ code: number, data: FrozenApproval[] }>(event, 'pending', {})
  if (pending.code !== 0 || !Array.isArray(pending.data) || pending.data.length > 40) throw createError({ statusCode: 503 })
  let bound = 0
  let deferred = 0
  const deadline = Date.now() + 15000
  for (const request of pending.data.slice(0, 3)) {
    if (Date.now() >= deadline) break
    try {
      await createAltocApprovalInstance(event, request, Math.max(1, Math.min(3000, deadline - Date.now())))
      const result = await callEnterpriseAltocApprovalWorker<{ code: number, data: { bound: boolean } }>(event, 'bind', { requestNo: request.requestNo })
      if (result.code !== 0 || result.data?.bound !== true) throw createError({ statusCode: 503 })
      bound++
    } catch { deferred++ }
  }
  return { bound, deferred, remaining: pending.data.length - bound }
}
