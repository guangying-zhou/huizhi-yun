import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadProjectCommandAuthorization } from '@hzy/foundation/server/utils/projectCommandAuthorization'
import { workflowRequest } from './enterpriseWorkflowProxy'

interface LifecycleRequest {
  requestNo: string
  status: string
  instanceId: string
  snapshot: { projectId: string, actionCode: 'pause' | 'resume' | 'finish', requestedBy: string, comment: string, expectedVersion: string }
}

export async function enterpriseAimsProjectLifecycle(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const projectId = String(getRouterParam(event, 'id') || '')
  const key = String(getHeader(event, 'idempotency-key') || '').trim()
  const input = await readBody<Record<string, unknown>>(event)
  if (!/^[1-9]\d*$/.test(projectId) || !Number.isSafeInteger(Number(projectId)) || !key || key.length > 180 || Object.keys(getQuery(event)).length
    || !input || Array.isArray(input) || Object.keys(input).some(name => !['actionCode', 'expectedVersion', 'comment'].includes(name))
    || !['pause', 'resume', 'finish'].includes(String(input.actionCode)) || typeof input.comment !== 'string'
    || !input.comment.trim() || input.comment.length > 4000 || !/^[a-f0-9]{64}$/.test(String(input.expectedVersion))) {
    throw createError({ statusCode: 400, message: '项目审批申请参数无效' })
  }
  const user = await requireEnterpriseUser(event)
  const action = input.actionCode === 'finish' ? 'close' : 'edit'
  const permit = await loadProjectCommandAuthorization(event, user, { resource: 'projects', action, projectId, workItemId: '' })
  const envelope = {
    tenant: user.tenant, deployment: user.deployment, projectId,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'projects', action, expiresAt: permit.expiresAt },
    projectWriteAuthorization: { ...permit, objectId: '', subId: '' }
  }
  await prepareEnterpriseRuntime(event, 'aims.project-lifecycle-request')
  const frozen = await callEnterpriseRuntime<{ code: number, data: LifecycleRequest }>(event, 'aims.project-lifecycle-request', { ...envelope, payload: input }, { idempotencyKey: key })
  const request = frozen.data
  if (frozen.code !== 0 || !request?.requestNo || request.snapshot?.projectId !== projectId || request.snapshot.requestedBy !== user.uid || request.snapshot.actionCode !== input.actionCode) {
    throw createError({ statusCode: 503, message: '项目审批冻结快照暂不可用' })
  }
  try {
    if (request.instanceId) return frozen
    if (request.status !== 'pending') throw createError({ statusCode: 409, message: '该审批申请已结束，请刷新项目后重新确认' })
    // Only the owning Runtime snapshot forms the Workflow business identity and form.
    const form = { ...request.snapshot, requestNo: request.requestNo, appCode: 'aims', resourceCode: 'projects' }
    const biz = { app_code: 'aims', resource_code: 'projects', action_code: request.snapshot.actionCode, biz_id: projectId, biz_title: `项目${projectId} ${request.snapshot.actionCode}`, form_data: form }
    const prepared = await workflowRequest<{ code: number, data: { action_def: { id: number, resource_code: string, action_code: string }, matched_routes: { id: number }[] } }>(event, user.uid, 'instances/prepare', { method: 'POST', body: biz })
    if (prepared.code !== 0 || prepared.data?.action_def?.resource_code !== 'projects' || prepared.data.action_def.action_code !== request.snapshot.actionCode || !prepared.data.action_def.id || !prepared.data.matched_routes?.[0]?.id) throw createError({ statusCode: 503, message: '项目审批流程尚未配置，请稍后按同一请求重试' })
    const created = await workflowRequest<{ code: number, data: { instance_id: number, instance_no: string } }>(event, user.uid, 'instances', {
      method: 'POST', key: request.requestNo,
      body: { action_def_id: prepared.data.action_def.id, route_id: prepared.data.matched_routes[0].id, biz_id: projectId, biz_title: biz.biz_title, biz_url: `/aims/projects/${projectId}/edit`, form_data: form, callback_url: '/api/v1/service/workflow/callback' }
    })
    if (created.code !== 0 || !Number.isSafeInteger(created.data?.instance_id) || created.data.instance_id <= 0 || typeof created.data.instance_no !== 'string' || !created.data.instance_no.trim()) throw createError({ statusCode: 503, message: '项目审批创建结果未确认，请按同一请求重试' })
    // Workflow may take longer than the short-lived project permit: reauthorize binding.
    const bindingPermit = await loadProjectCommandAuthorization(event, user, { resource: 'projects', action, projectId, workItemId: '' })
    const binding = { ...envelope, authorization: { ...envelope.authorization, expiresAt: bindingPermit.expiresAt }, projectWriteAuthorization: { ...bindingPermit, objectId: '', subId: '' } }
    await prepareEnterpriseRuntime(event, 'aims.project-lifecycle-bind')
    const bound = await callEnterpriseRuntime<{ code: number, data: { bound: boolean, instanceId: string } }>(event, 'aims.project-lifecycle-bind', { ...binding, payload: { actionCode: request.snapshot.actionCode, requestNo: request.requestNo, instanceId: String(created.data.instance_id), instanceNo: created.data.instance_no } }, { idempotencyKey: key })
    if (bound.code !== 0 || bound.data?.bound !== true || bound.data.instanceId !== String(created.data.instance_id)) throw createError({ statusCode: 503, message: '审批绑定结果未确认，请按同一请求重试' })
    return { code: 0, data: { ...request, instanceId: String(created.data.instance_id) } }
  } catch (cause) {
    const failure = cause as { statusCode?: number, status?: number, message?: string, data?: Record<string, unknown> }
    throw createError({ statusCode: failure.statusCode || failure.status || 503, message: failure.message || '审批创建或绑定结果未确认', data: { ...failure.data, requestFrozen: true } })
  }
}

export async function enterpriseAimsProjectModules(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const projectId = String(getRouterParam(event, 'id') || '')
  const key = String(getHeader(event, 'idempotency-key') || '').trim()
  const input = await readBody<Record<string, unknown>>(event)
  const moduleKeys = ['milestones', 'workflows', 'requirements', 'releases', 'environments', 'service_desk', 'decomposition']
  const config = input?.moduleConfig as Record<string, unknown> | undefined
  if (!/^[1-9]\d*$/.test(projectId) || !Number.isSafeInteger(Number(projectId)) || !key || key.length > 180 || Object.keys(getQuery(event)).length
    || !input || Array.isArray(input) || Object.keys(input).length !== 3 || Object.keys(input).some(name => !['expectedVersion', 'expectedModuleConfig', 'moduleConfig'].includes(name))
    || !/^[a-f0-9]{64}$/.test(String(input.expectedVersion)) || !config || Array.isArray(config) || Object.keys(config).length !== moduleKeys.length || moduleKeys.some(name => typeof config[name] !== 'boolean')) {
    throw createError({ statusCode: 400, message: '项目模块配置参数无效' })
  }
  const user = await requireEnterpriseUser(event)
  const permit = await loadProjectCommandAuthorization(event, user, { resource: 'projects', action: 'edit', projectId, workItemId: '' })
  await prepareEnterpriseRuntime(event, 'aims.project-modules-update')
  return await callEnterpriseRuntime(event, 'aims.project-modules-update', {
    tenant: user.tenant, deployment: user.deployment, projectId, payload: input,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'projects', action: 'edit', expiresAt: permit.expiresAt },
    projectWriteAuthorization: { ...permit, objectId: '', subId: '' }
  }, { idempotencyKey: key })
}
