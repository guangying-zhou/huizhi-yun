import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { requestServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { resolveWorkflowApiUrl } from '@hzy/foundation/server/utils/workflowRuntime'
import { workflowProxyErrorData } from '@hzy/foundation/server/utils/workflowProxyError'
import { fetchExternal } from '@hzy/foundation/server/utils/externalFetch'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { optionalReadPagination } from '@hzy/foundation/shared/utils/optionalReadPagination'
import { HOST_WORKFLOW_BASE_PATH, resolveEnterpriseHostWorkflowConfig } from '../../shared/host-workflow-config.mjs'
import { enterpriseAltocRead } from './enterpriseAltocReads'
import { callFinanceLedger, normalizeFinanceLedgerRequest } from './enterpriseFinanceLedger'
import { readEnterprisePeopleAssignmentByCode } from './enterprisePeople'
import { projectRead } from './enterpriseAimsProjects'
import { enterpriseAimsWorkflowItem } from './enterpriseAimsWorkItems'

const positiveID = /^[1-9]\d*$/
const workflowKey = 'aims/tasks/complete'
const lifecycleWorkflowKeys = ['aims/projects/pause', 'aims/projects/resume', 'aims/projects/finish']
const altocWorkflowKeys = ['altoc/quotation/approve', 'altoc/contract/approve']
const financeWorkflowKeys = ['finance/invoices/request', 'finance/expenses/claim', 'finance/expenses/project_expense', 'finance/expenses/payment']
const peopleWorkflowKey = 'people/assignments/change'
const registeredWorkflow = (key: string) => key === peopleWorkflowKey || financeWorkflowKeys.includes(key) || key === workflowKey || lifecycleWorkflowKeys.includes(key) || altocWorkflowKeys.includes(key)
type WorkflowOperation = 'by-biz' | 'history' | 'instance' | 'pending' | 'task' | 'approve' | 'reject'

function fail(statusCode: number, message: string): never {
  throw createError({ statusCode, message })
}

function hostWorkflowConfig() {
  // The startup plugin already refuses an invalid configuration; re-check per
  // request so a changed environment can only fail closed, never widen.
  try {
    return resolveEnterpriseHostWorkflowConfig(process.env)
  } catch {
    fail(503, '本机 Workflow 尚未就绪')
  }
}

function id(value: unknown): string {
  const normalized = String(value || '').trim()
  if (!positiveID.test(normalized) || !Number.isSafeInteger(Number(normalized))) fail(400, '工作项或流程标识无效')
  return normalized
}

function assignmentCode(value: unknown): string {
  const code = String(value || '')
  if (!/^ASN-[0-9a-f]{32}$/.test(code)) fail(400, '任职编号无效')
  return code
}

function financeCode(value: unknown): string {
  const code = String(value || '')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/.test(code)) fail(400, '开票申请编号无效')
  return code
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
  const task = value.resource_code === 'tasks' && (history || value.action_code === 'complete')
  const project = !history && lifecycleWorkflowKeys.includes(`aims/${value.resource_code}/${value.action_code}`)
  const altoc = value.app_code === 'altoc' && ['quotation', 'contract'].includes(String(value.resource_code)) && (history || value.action_code === 'approve')
  const finance = value.app_code === 'finance' && ((value.resource_code === 'invoices' && (history || value.action_code === 'request')) || (value.resource_code === 'expenses' && (history || ['claim', 'project_expense', 'payment'].includes(String(value.action_code)))))
  if (value.app_code === 'people' && value.resource_code === 'assignments' && (history || value.action_code === 'change')) return assignmentCode(value.biz_id)
  if (finance) return financeCode(value.biz_id)
  if (!altoc && (value.app_code !== 'aims' || (!task && !project))) fail(403, '未登记的审批业务动作')
  return id(value.biz_id)
}

export async function workflowRequest<T>(event: H3Event, uid: string, path: string, options: { method?: 'GET' | 'POST', query?: Record<string, string>, body?: Record<string, unknown>, key?: string, timeoutMs?: number } = {}): Promise<T> {
  // Topology comes only from explicit process configuration. A Host-local
  // Workflow (self-hosted or the hzy0 profile) dials exactly its validated
  // loopback origin and never consults the shared tenant setting or managed
  // service discovery; an explicit 'false' fails closed; unset keeps the
  // managed-cloud discovery path.
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 30000)) fail(400, '审批请求预算无效')
  const hostWorkflow = hostWorkflowConfig()
  if (hostWorkflow.mode === 'disabled') fail(503, '本机 Workflow 尚未就绪')
  const base = hostWorkflow.mode === 'loopback' ? hostWorkflow.apiBaseUrl : await resolveWorkflowApiUrl(event)
  if (!base) fail(503, '本机 Workflow 尚未就绪')
  const url = new URL(`${base.replace(/\/+$/, '')}/api/v1/${path}`)
  if (hostWorkflow.mode === 'loopback' && (url.origin !== hostWorkflow.origin || !url.pathname.startsWith(`${HOST_WORKFLOW_BASE_PATH}/`))) fail(503, '本机 Workflow 尚未就绪')
  for (const [name, value] of Object.entries(options.query || {})) url.searchParams.set(name, value)
  url.searchParams.set('request_app_code', 'enterprise')
  const headers = new Headers(trustedServiceRequestHeaders(event, 'workflow'))
  headers.set('authorization', `Bearer ${await requestServiceAccessToken({ audience: 'workflow', scope: 'workflow:proxy', event })}`)
  headers.set('x-hzy-request-app-code', 'enterprise')
  headers.set('x-hzy-actor-uid', uid)
  if (options.key) headers.set('idempotency-key', options.key)
  try {
    return await fetchExternal<T>(url.toString(), { method: options.method || 'GET', headers, ...(options.timeoutMs ? { timeout: options.timeoutMs, retry: 0 } : {}), ...(options.body ? { body: options.body } : {}) })
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
  if (!registeredWorkflow(`${instance.app_code}/${instance.resource_code}/${instance.action_code}`)) fail(403, '流程实例不属于当前业务动作')
  return { bizID: instance.app_code === 'people' ? assignmentCode(instance.biz_id) : instance.app_code === 'finance' ? financeCode(instance.biz_id) : id(instance.biz_id), resource: String(instance.resource_code), app: String(instance.app_code) }
}

async function checkedInstance(event: H3Event, uid: string, kind: 'task' | 'instance', targetID: string) {
  const result = await workflowRequest<unknown>(event, uid, `${kind === 'task' ? 'tasks' : 'instances'}/${targetID}`)
  const business = assertInstance(result)
  if (business.app === 'people') await readEnterprisePeopleAssignmentByCode(event, business.bizID)
  else if (business.app === 'finance') await authorizeFinanceWorkflowBusiness(event, business.resource, business.bizID)
  else if (business.app === 'altoc') await enterpriseAltocRead(event, business.resource as 'quotation' | 'contract', true, business.bizID)
  else if (business.resource === 'projects') await projectRead(event, 'aims.project-view', {}, business.bizID)
  else await enterpriseAimsWorkflowItem(event, business.bizID)
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
  if (!registeredWorkflow(`${instance.app_code}/${instance.resource_code}/${instance.action_code}`)) fail(404, '审批任务不存在')
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
      form_data: instance.form_data, biz_context: instance.biz_context,
      people_summary: instance.people_summary
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
    exactKeys(query, ['page', 'pageSize', 'app_code', 'resource_code', 'action_code'])
    const selectorFields = ['app_code', 'resource_code', 'action_code']
    if (selectorFields.some(key => query[key] !== undefined) && selectorFields.some(key => typeof query[key] !== 'string')) fail(400, '审批业务筛选不完整')
    const selectedKey = query.app_code === undefined && query.resource_code === undefined && query.action_code === undefined ? workflowKey : `${query.app_code}/${query.resource_code}/${query.action_code}`
    if (!registeredWorkflow(selectedKey)) fail(403, '未登记的审批业务动作')
    const [app, resource, action] = selectedKey.split('/')
    try {
      optionalReadPagination(Object.fromEntries(Object.entries(query).filter(([key]) => ['page', 'pageSize'].includes(key))))
    } catch {
      fail(400, '待办分页无效')
    }
    const page = Number(query.page || 1)
    const pageSize = Number(query.pageSize || 20)
    await taskPermissions(event, uid)
    const upstream = await workflowRequest<unknown>(event, uid, 'tasks/pending', { query: {
      app_code: app!, resource_code: resource!, action_code: action!, exclude_initiator: 'true',
      page: String(page), pageSize: String(pageSize)
    } })
    const data = responseData(upstream)
    if (!Array.isArray(data.items) || !Number.isSafeInteger(data.total) || Number(data.total) < 0
      || data.page !== page || data.pageSize !== pageSize || data.items.length > pageSize) fail(502, '待办响应无效')
    // Runtime owns eligibility and total. Reject an inconsistent response as a
    // whole; never hide rows after pagination or report an unfiltered total.
    const items = data.items.map((value: unknown) => {
      const item = record(value)
      if (`${item.app_code}/${item.resource_code}/${item.action_code}` !== selectedKey || String(item.initiator_uid || '') === uid) fail(502, '待办范围响应无效')
      return { task_id: item.task_id, instance_no: item.instance_no, biz_title: item.biz_title, action_name: item.action_name, node_name: item.node_name, created_at: item.created_at }
    })
    return { code: 0, data: { items, total: data.total, page, pageSize, nextPage: page * pageSize < Number(data.total) ? page + 1 : null } }
  }

  if (operation === 'by-biz' || operation === 'history') {
    const query = getQuery(event)
    const bizID = knownBusiness(query, operation === 'history')
    if (query.app_code === 'people') await readEnterprisePeopleAssignmentByCode(event, bizID)
    else if (query.app_code === 'finance') await authorizeFinanceWorkflowBusiness(event, String(query.resource_code), bizID)
    else if (query.app_code === 'altoc') await enterpriseAltocRead(event, query.resource_code as 'quotation' | 'contract', true, bizID)
    else if (query.resource_code === 'projects') await projectRead(event, 'aims.project-view', {}, bizID)
    else await enterpriseAimsWorkflowItem(event, bizID)
    return await workflowRequest(event, uid, operation === 'history' ? 'instances/by-biz-history' : 'instances/by-biz', {
      query: { app_code: String(query.app_code), resource_code: String(query.resource_code), biz_id: bizID, ...(operation === 'history' ? {} : { action_code: String(query.action_code), include_history: query.include_history === 'true' ? 'true' : 'false' }) }
    })
  }

  if (operation === 'instance' || operation === 'task' || operation === 'approve' || operation === 'reject') {
    if (Object.keys(getQuery(event)).length) fail(400, '审批请求不接受查询参数')
    const targetID = id(getRouterParam(event, 'id'))
    if (operation === 'instance') return await checkedInstance(event, uid, 'instance', targetID)
    const permissions = await taskPermissions(event, uid)
    const read = await workflowRequest<unknown>(event, uid, `tasks/${targetID}`)
    const snapshot = taskSnapshot(read, uid)
    if (snapshot.instance.app_code === 'people') {
      const assignment = await readEnterprisePeopleAssignmentByCode(event, assignmentCode(snapshot.instance.biz_id))
      snapshot.instance.people_summary = {
        employee: assignment.employee_uid, changeType: assignment.change_type,
        department: assignment.dept_name, position: assignment.position_name,
        effectiveDate: assignment.effective_from, href: `/people/assignments/${assignment.id}`
      }
    }
    if (operation === 'task') return { code: 0, data: projectedTask(snapshot, permissions) }
    if (!permissions[operation] || snapshot.capabilities[`can_${operation}`] !== true) fail(403, '当前用户没有此审批操作权限')
    const body = record(await readBody(event))
    exactKeys(body, operation === 'approve' ? ['comment', 'attachments'] : ['comment'])
    if (operation === 'reject' && !String(body.comment || '').trim()) fail(400, '驳回原因不能为空')
    return await workflowRequest(event, uid, `tasks/${targetID}/${operation}`, { method: 'POST', body, key: requestKey(event) })
  }
}

async function authorizeFinanceWorkflowBusiness(event: H3Event, resource: string, code: string) {
  if (resource === 'invoices') return await callFinanceLedger(event, 'invoice-requests-detail', normalizeFinanceLedgerRequest('invoice-requests-detail', code, {}, {}))
  // Expense business codes are owning-generated and namespaces are disjoint.
  const operation = code.startsWith('CLM-') ? 'claims-detail' : code.startsWith('PER-') ? 'project-requests-detail' : code.startsWith('PAY-') ? 'payment-requests-detail' : null
  if (resource !== 'expenses' || !operation) throw createError({ statusCode: 403 })
  return await callFinanceLedger(event, operation, normalizeFinanceLedgerRequest(operation, code, {}, {}))
}
