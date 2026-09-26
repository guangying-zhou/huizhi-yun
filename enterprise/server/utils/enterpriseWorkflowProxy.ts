import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { requestServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { resolveWorkflowApiUrl } from '@hzy/foundation/server/utils/workflowRuntime'
import { workflowProxyErrorData } from '@hzy/foundation/server/utils/workflowProxyError'
import { fetchExternal } from '@hzy/foundation/server/utils/externalFetch'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { enterpriseAimsWorkflowItem } from './enterpriseAimsWorkItems'

const positiveID = /^[1-9]\d*$/
const workflowKey = 'aims/tasks/complete'
type WorkflowOperation = 'by-biz' | 'history' | 'instance' | 'pending' | 'task' | 'approve' | 'reject'

function fail(statusCode: number, message: string): never {
  throw createError({ statusCode, message })
}

function id(value: unknown): string {
  const normalized = String(value || '').trim()
  if (!positiveID.test(normalized) || !Number.isSafeInteger(Number(normalized))) fail(400, '工作项或流程标识无效')
  return normalized
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '审批参数无效')
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(400, '审批参数包含不支持的字段')
}

function knownBusiness(value: Record<string, unknown>, history = false) {
  exactKeys(value, history
    ? ['app_code', 'resource_code', 'biz_id']
    : ['app_code', 'resource_code', 'biz_id', 'action_code', 'include_history'])
  if (value.app_code !== 'aims' || value.resource_code !== 'tasks' || (!history && value.action_code !== 'complete')) fail(403, '未登记的审批业务动作')
  return id(value.biz_id)
}

async function workflowRequest<T>(event: H3Event, uid: string, path: string, options: { method?: 'GET' | 'POST', query?: Record<string, string>, body?: Record<string, unknown>, key?: string } = {}): Promise<T> {
  // The private hzy0 runner owns this override. Never consult the shared
  // tenant setting or managed service discovery in the local test profile.
  const local = process.env.HZY0_LOCAL_ENTERPRISE === 'true'
  const base = local ? process.env.HZY_WORKFLOW_API_URL : await resolveWorkflowApiUrl(event)
  if (!base) fail(503, '本机 Workflow 尚未就绪')
  const url = new URL(`${base.replace(/\/+$/, '')}/api/v1/${path}`)
  if (local && (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '23140' || !url.pathname.startsWith('/workflow/'))) fail(503, '本机 Workflow 尚未就绪')
  for (const [name, value] of Object.entries(options.query || {})) url.searchParams.set(name, value)
  url.searchParams.set('request_app_code', 'enterprise')
  const headers = new Headers(trustedServiceRequestHeaders(event, 'workflow'))
  headers.set('authorization', `Bearer ${await requestServiceAccessToken({ audience: 'workflow', scope: 'workflow:proxy', event })}`)
  headers.set('x-hzy-request-app-code', 'enterprise')
  headers.set('x-hzy-actor-uid', uid)
  if (options.key) headers.set('idempotency-key', options.key)
  try {
    return await fetchExternal<T>(url.toString(), { method: options.method || 'GET', headers, ...(options.body ? { body: options.body } : {}) })
  } catch (error) {
    const mapped = workflowProxyErrorData(error)
    throw createError({ statusCode: mapped.statusCode, statusMessage: mapped.statusMessage, message: mapped.message, data: { code: mapped.code, message: mapped.message } })
  }
}

function responseData(value: unknown) {
  const outer = record(value)
  return record(outer.data)
}

function assertInstance(value: unknown) {
  const data = responseData(value)
  const instance = data.instance && typeof data.instance === 'object' ? record(data.instance) : data
  if (`${instance.app_code}/${instance.resource_code}/${instance.action_code}` !== workflowKey) fail(403, '流程实例不属于当前业务动作')
  return id(instance.biz_id)
}

async function checkedInstance(event: H3Event, uid: string, kind: 'task' | 'instance', targetID: string) {
  const result = await workflowRequest<unknown>(event, uid, `${kind === 'task' ? 'tasks' : 'instances'}/${targetID}`)
  const bizID = assertInstance(result)
  await enterpriseAimsWorkflowItem(event, bizID)
  return result
}

async function taskPermissions(event: H3Event, uid: string) {
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(uid, 'workflow', event)
  const allowed = (action: 'approve' | 'reject') => authorizationResourcesAllow(snapshot.resources, 'workflow_tasks', action, snapshot.actionPolicies?.workflow_tasks)
  const result = { approve: allowed('approve'), reject: allowed('reject') }
  if (!result.approve && !result.reject) fail(403, '当前用户没有审批任务权限')
  return result
}

function taskSnapshot(value: unknown, uid: string) {
  const data = responseData(value)
  const task = record(data.task)
  const instance = record(data.instance)
  if (`${instance.app_code}/${instance.resource_code}/${instance.action_code}` !== workflowKey) fail(404, '审批任务不存在')
  if (String(task.assignee_uid || '') !== uid || String(instance.initiator_uid || '') === uid) fail(403, '当前用户不是合格审批人')
  if (task.status !== 'pending' || instance.status !== 'running') fail(409, '审批任务已处理')
  return { task, instance, capabilities: record(data.capabilities) }
}

function projectedTask(value: ReturnType<typeof taskSnapshot>, permissions: Awaited<ReturnType<typeof taskPermissions>>) {
  const { task, instance, capabilities } = value
  return {
    task: { id: task.id, status: task.status, node_name: task.node_name, created_at: task.created_at },
    instance: {
      id: instance.id, instance_no: instance.instance_no, action_name: instance.action_name,
      biz_title: instance.biz_title, initiator_uid: instance.initiator_uid, created_at: instance.created_at,
      form_data: instance.form_data, biz_context: instance.biz_context
    },
    capabilities: {
      can_approve: permissions.approve && capabilities.can_approve === true,
      can_reject: permissions.reject && capabilities.can_reject === true
    }
  }
}

function requestKey(event: H3Event) {
  const key = String(getHeader(event, 'idempotency-key') || '').trim()
  if (!key || key.length > 191 || [...key].some((character) => {
    const code = character.codePointAt(0) || 0
    return code < 32 || code === 127
  })) fail(400, '缺少有效的审批操作标识')
  return key
}

export async function enterpriseWorkflowProxy(event: H3Event, operation: WorkflowOperation) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const uid = user.uid

  if (operation === 'pending') {
    const query = getQuery(event)
    exactKeys(query, ['page'])
    const page = query.page === undefined ? 1 : Number(query.page)
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) fail(400, '待办页码无效')
    await taskPermissions(event, uid)
    const upstream = await workflowRequest<unknown>(event, uid, 'tasks/pending', { query: { app_code: 'aims', page: String(page), page_size: '20' } })
    const data = responseData(upstream)
    if (!Array.isArray(data.items) || !Number.isSafeInteger(Number(data.total)) || Number(data.total) < 0) fail(502, '待办响应无效')
    const items = data.items.map(record).filter((item: Record<string, unknown>) => {
      return `${item.app_code}/${item.resource_code}/${item.action_code}` === workflowKey && String(item.initiator_uid || '') !== uid
    }).map((item: Record<string, unknown>) => ({ task_id: item.task_id, instance_no: item.instance_no, biz_title: item.biz_title, action_name: item.action_name, node_name: item.node_name, created_at: item.created_at }))
    return { code: 0, data: { items, page, nextPage: page * 20 < Number(data.total) ? page + 1 : null } }
  }

  if (operation === 'by-biz' || operation === 'history') {
    const query = getQuery(event)
    const bizID = knownBusiness(query, operation === 'history')
    await enterpriseAimsWorkflowItem(event, bizID)
    return await workflowRequest(event, uid, operation === 'history' ? 'instances/by-biz-history' : 'instances/by-biz', {
      query: { app_code: 'aims', resource_code: 'tasks', biz_id: bizID, ...(operation === 'history' ? {} : { action_code: 'complete', include_history: query.include_history === 'true' ? 'true' : 'false' }) }
    })
  }

  if (operation === 'instance' || operation === 'task' || operation === 'approve' || operation === 'reject') {
    if (Object.keys(getQuery(event)).length) fail(400, '审批请求不接受查询参数')
    const targetID = id(getRouterParam(event, 'id'))
    if (operation === 'instance') return await checkedInstance(event, uid, 'instance', targetID)
    const permissions = await taskPermissions(event, uid)
    const read = await workflowRequest<unknown>(event, uid, `tasks/${targetID}`)
    const snapshot = taskSnapshot(read, uid)
    if (operation === 'task') return { code: 0, data: projectedTask(snapshot, permissions) }
    if (!permissions[operation] || snapshot.capabilities[`can_${operation}`] !== true) fail(403, '当前用户没有此审批操作权限')
    const body = record(await readBody(event))
    exactKeys(body, operation === 'approve' ? ['comment', 'attachments'] : ['comment'])
    if (operation === 'reject' && !String(body.comment || '').trim()) fail(400, '驳回原因不能为空')
    return await workflowRequest(event, uid, `tasks/${targetID}/${operation}`, { method: 'POST', body, key: requestKey(event) })
  }
}
