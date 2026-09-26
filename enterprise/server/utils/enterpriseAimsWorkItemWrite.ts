import { enterpriseAimsPersonnel } from './enterpriseAimsPersonnel'
import { enterpriseAimsProjectScope } from './enterpriseAimsProjects'
import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'

const basic = new Set(['title', 'description', 'priority', 'assigneeUid', 'startDate', 'dueDate', 'estimatedHours'])
const create = new Set([...basic, 'type', 'tier', 'milestoneId', 'routineScope', 'beneficiaryDeptCode', 'isUnplanned', 'reviewLevel', 'required', 'severity', 'weight'])
const numeric = /^[1-9]\d*$/
type Action = 'create' | 'edit' | 'delete' | 'associate' | 'complete' | 'matter-complete' | 'completion-replay' | 'plan-ready' | 'start' | 'reset' | 'reopen' | 'confirm-distribute' | 'revoke-distribute' | 'confirm-append' | 'reject-append' | 'append-tasks' | 'breakdown'

export async function enterpriseAimsWorkItemWrite(event: H3Event, action: Action) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '工作项操作参数无效' })
  const key = String(getHeader(event, 'Idempotency-Key') || '').trim()
  const raw = await readBody<Record<string, unknown>>(event)
  if (!raw || Array.isArray(raw) || !key || key.length > 191) throw createError({ statusCode: 400, message: '缺少有效操作参数或操作标识' })
  const projectId = action === 'create' ? String(getRouterParam(event, 'id') || '') : String(raw.projectId || '')
  const workItemId = action !== 'create' ? String(getRouterParam(event, 'id') || '') : ''
  if (!numeric.test(projectId) || (workItemId && !numeric.test(workItemId))) throw createError({ statusCode: 400, message: '项目或工作项标识无效' })
  const input = { ...raw }
  delete input.projectId
  const fields = action === 'create' ? create : action === 'completion-replay' ? new Set(['expectedOperationVersion', 'reason']) : ['complete', 'matter-complete', 'delete', 'plan-ready', 'start', 'reset', 'reopen', 'confirm-distribute', 'revoke-distribute', 'confirm-append', 'reject-append'].includes(action) ? new Set(['expectedVersion']) : ['append-tasks', 'breakdown'].includes(action) ? new Set(['expectedVersion', 'subtasks']) : action === 'associate' ? new Set(['versionId', 'featureId', 'expectedVersion']) : new Set([...basic, 'expectedVersion'])
  if (!Object.keys(input).length || Object.keys(input).some(k => !fields.has(k))) throw createError({ statusCode: 400, message: '不支持该操作中的字段' })
  const permissionAction = action === 'completion-replay' ? 'replay' : action === 'create' ? 'create' : action === 'delete' ? 'delete' : ['confirm-distribute', 'confirm-append', 'reject-append'].includes(action) ? 'confirm' : 'edit'
  const resource = action === 'completion-replay' ? 'integration_operations' : 'work_items'
  const user = await requireEnterpriseUser(event)
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'aims', { resourceCode: resource, action: permissionAction })
  if (scoped.decision?.allowed !== true) throw createError({ statusCode: 403, message: '当前用户没有工作项操作权限' })
  const operation = `aims.work-item-${action}` as const
  await prepareEnterpriseRuntime(event, operation)
  const withoutPersonnel = ['complete', 'matter-complete', 'completion-replay', 'delete', 'plan-ready', 'start', 'reset', 'reopen', 'confirm-distribute', 'revoke-distribute', 'confirm-append', 'reject-append', 'append-tasks', 'breakdown'].includes(action)
  const personnel = withoutPersonnel ? [] : await enterpriseAimsPersonnel(event, user, input, 'assigneeUid', 'work_items', action === 'create' ? `project:${projectId}` : workItemId, action)
  const needsProjectScope = ['delete', 'plan-ready', 'start', 'reset', 'reopen', 'confirm-distribute', 'revoke-distribute', 'confirm-append', 'reject-append', 'append-tasks', 'breakdown'].includes(action)
  const projectScope = needsProjectScope ? await enterpriseAimsProjectScope(event, user.uid) : undefined
  return await callEnterpriseRuntime(event, operation, {
    ...(projectScope ? { projectScope } : {}), personnel, tenant: user.tenant, deployment: user.deployment, projectId, workItemId, input,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource, action: permissionAction, projectId, workItemId, allowed: true, expiresAt: enterpriseRuntimePermitExpiresAt() }
  }, { idempotencyKey: key })
}
