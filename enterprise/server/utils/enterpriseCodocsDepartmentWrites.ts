import { createError, getHeader, getQuery, getRequestURL, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createRuntimeOSSClient, resolveDocumentOssTimeoutMs } from '../../../codocs/server/utils/oss'
import { copyRestoreObjects } from './codocsRestoreObjects'

type Operation = Parameters<typeof prepareEnterpriseRuntime>[1]
const code = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,189}$/
const safePath = (value: unknown): value is string => typeof value === 'string' && /^(codocs|recycle\.bin)\//.test(value)
  // eslint-disable-next-line no-control-regex -- reject NUL and line breaks in object keys
  && !/[\\\x00\r\n]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..')
const bad = (message: string) => createError({ statusCode: 400, message })

function boundedCode(value: unknown) {
  if (typeof value !== 'string' || !code.test(value)) throw bad('部门编码无效')
  return value
}
function boundUuid(value: unknown) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw bad('文档标识无效')
  return value
}
function boundId(value: unknown) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw bad('目录标识无效')
  return value
}
function key(event: H3Event) {
  const value = getHeader(event, 'idempotency-key') || ''
  if (!keyPattern.test(value)) throw bad('操作需要有效的 Idempotency-Key')
  return value
}
function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(field => !fields.includes(field))) throw bad('请求字段无效')
  return value as Record<string, unknown>
}
function noQuery(event: H3Event) {
  if (getRequestURL(event).search) throw bad('操作不接受查询参数')
  setHeader(event, 'Cache-Control', 'no-store')
}
async function authorize(event: H3Event, operation: Operation, action: 'view' | 'create' | 'edit') {
  const user = await requireEnterpriseUser(event)
  await prepareEnterpriseRuntime(event, operation)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'departments', action, snapshot.actionPolicies?.departments)) {
    throw createError({ statusCode: 403, message: '缺少部门文档操作权限' })
  }
  return user
}
async function invoke(event: H3Event, operation: Operation, resource: 'department-documents' | 'department-folders', action: 'read' | 'edit', dept: string, extra: Record<string, unknown>, requestKey?: string): Promise<{ success?: boolean, data?: Record<string, unknown> }> {
  const user = await authorize(event, operation, action === 'read' ? 'view' : 'edit')
  try {
    return await callEnterpriseRuntime(event, operation, {
      tenant: user.tenant, deployment: user.deployment, code: dept, ...extra,
      authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource, action, expiresAt: enterpriseRuntimePermitExpiresAt() }
    }, requestKey ? { idempotencyKey: requestKey } : {}) as { success?: boolean, data?: Record<string, unknown> }
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    if (status === 403 || status === 404 || status === 409 || status === 400) throw error
    throw createError({ statusCode: 503, message: '部门文档服务暂不可用' })
  }
}
function result(value: { success?: boolean, data?: Record<string, unknown> }, field: string, expected: string) {
  if (value?.success !== true || !value.data || String(value.data[field]).toLowerCase() !== expected.toLowerCase()) throw createError({ statusCode: 503, message: '部门文档响应无效' })
  return value
}

export async function manageEnterpriseDepartmentFolder(event: H3Event, action: 'update' | 'delete' | 'open') {
  noQuery(event)
  const requestKey = key(event)
  const id = boundId(getRouterParam(event, 'id'))
  const body = object(await readBody(event), action === 'update' ? ['dept_code', 'name', 'parent_id'] : action === 'open' ? ['dept_code', 'is_open'] : ['dept_code'])
  const dept = boundedCode(body.dept_code)
  const payload: Record<string, unknown> = {}
  if (action === 'update') {
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim() || [...body.name.trim()].length > 100) throw bad('目录名称无效')
      payload.name = body.name.trim()
    }
    if (body.parent_id !== undefined) {
      if (body.parent_id !== null && (typeof body.parent_id !== 'number' || !Number.isSafeInteger(body.parent_id) || body.parent_id < 1)) throw bad('上级目录无效')
      payload.parent_id = body.parent_id
    }
    if (!Object.keys(payload).length) throw bad('没有目录变更')
  } else if (action === 'open') {
    if (typeof body.is_open !== 'boolean') throw bad('目录开放状态无效')
    payload.is_open = body.is_open
  }
  const operation = `codocs.department-folders-${action}` as Operation
  return result(await invoke(event, operation, 'department-folders', 'edit', dept, { objectId: id, payload }, requestKey), 'id', id)
}

export async function manageEnterpriseDepartmentDocument(event: H3Event, action: 'edit-metadata' | 'readonly' | 'recycle') {
  noQuery(event)
  const requestKey = key(event)
  const uuid = boundUuid(getRouterParam(event, 'uuid'))
  const body = object(await readBody(event), action === 'edit-metadata' ? ['dept_code', 'title', 'folder_id'] : action === 'readonly' ? ['dept_code', 'readonly_flag'] : ['dept_code'])
  const dept = boundedCode(body.dept_code)
  const payload: Record<string, unknown> = {}
  if (action === 'edit-metadata') {
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim() || [...body.title.trim()].length > 255) throw bad('文档标题无效')
      payload.title = body.title.trim()
    }
    if (body.folder_id !== undefined) {
      if (body.folder_id !== null && (typeof body.folder_id !== 'number' || !Number.isSafeInteger(body.folder_id) || body.folder_id < 1)) throw bad('目标目录无效')
      payload.folder_id = body.folder_id
    }
    if (!Object.keys(payload).length) throw bad('没有文档变更')
  } else if (action === 'readonly') {
    if (typeof body.readonly_flag !== 'boolean') throw bad('只读状态无效')
    payload.readonly_flag = body.readonly_flag
  }
  return result(await invoke(event, `codocs.department-documents-${action}` as Operation, 'department-documents', 'edit', dept, { subId: uuid, payload }, requestKey), 'uuid', uuid)
}

export async function listEnterpriseDepartmentTrash(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const params = getRequestURL(event).searchParams
  const q = getQuery(event)
  if (Object.keys(q).some(field => !['dept_code', 'page', 'pageSize'].includes(field))) throw bad('回收站参数无效')
  const dept = boundedCode(q.dept_code)
  const query: Record<string, string> = {}
  for (const field of ['page', 'pageSize'] as const) {
    const value = q[field]
    if (value === undefined) continue
    if (typeof value !== 'string' || params.getAll(field).length !== 1 || !/^[1-9]\d*$/.test(value)
      || !Number.isSafeInteger(Number(value)) || Number(value) > (field === 'page' ? 1_000_000 : 200)) throw bad('分页参数无效')
    query[field] = value
  }
  if (params.getAll('dept_code').length !== 1) throw bad('部门编码无效')
  const response = await invoke(event, 'codocs.department-documents-trash', 'department-documents', 'read', dept, { query })
  const data = response?.data as { items?: unknown[], total?: number, page?: number, pageSize?: number } | undefined
  if (response?.success !== true || !data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total)) throw createError({ statusCode: 503, message: '回收站响应无效' })
  const items = data.items.map((raw) => {
    const row = raw as Record<string, unknown>
    if (!row || row.doc_type !== 'department' || row.dept_code !== dept || typeof row.uuid !== 'string' || !uuidPattern.test(row.uuid)) throw createError({ statusCode: 503, message: '回收站行无效' })
    return { uuid: row.uuid, title: row.title, folder_name: row.folder_name, deleted_at: row.deleted_at }
  })
  return { success: true, data: { items, total: data.total, page: data.page, pageSize: data.pageSize } }
}

type RestorePlan = { uuid: string, title: string, doc_type: string, dept_code: string, source_path: string, target_path: string, state_sha256: string, deleted: boolean, snapshot_backed?: boolean }
export async function restoreEnterpriseDepartmentDocument(event: H3Event) {
  noQuery(event)
  const requestKey = key(event)
  const uuid = boundUuid(getRouterParam(event, 'uuid'))
  const body = object(await readBody(event), ['dept_code', 'new_title'])
  const dept = boundedCode(body.dept_code)
  if (body.new_title !== undefined && (typeof body.new_title !== 'string' || !body.new_title.trim() || [...body.new_title.trim()].length > 255)) throw bad('恢复标题无效')
  const payload = body.new_title === undefined ? {} : { new_title: String(body.new_title).trim() }
  const response = await invoke(event, 'codocs.department-documents-restore-plan', 'department-documents', 'edit', dept, { subId: uuid, payload })
  const plan = response.data as unknown as RestorePlan
  if (response.success !== true || !plan || plan.uuid !== uuid || plan.doc_type !== 'department' || plan.dept_code !== dept
    || typeof plan.title !== 'string' || !plan.title || plan.deleted !== true || !/^[0-9a-f]{64}$/.test(plan.state_sha256)
    || !safePath(plan.source_path) || !safePath(plan.target_path)
    || (plan.snapshot_backed !== undefined && typeof plan.snapshot_backed !== 'boolean')
    || (plan.source_path.startsWith('codocs/') ? plan.target_path !== plan.source_path : plan.target_path !== `codocs/document-restores/${uuid}/${plan.state_sha256}.md`)) {
    throw createError({ statusCode: 503, message: '部门文档恢复计划无效' })
  }
  // A snapshot-backed (v2) document is restored by status only: the exact
  // snapshot head is the body, and the mirror/.yjs are neither required nor
  // copied (a missing mirror must not turn into a false "nothing to restore").
  if (plan.snapshot_backed !== true) await copyDepartmentRestoreObjects(event, plan)
  return restoreCommit(event, uuid, dept, payload, plan, requestKey)
}

async function copyDepartmentRestoreObjects(event: H3Event, plan: RestorePlan) {
  await copyRestoreObjects(
    () => createRuntimeOSSClient({ event, timeout: resolveDocumentOssTimeoutMs() }),
    plan,
    { unavailable: '恢复存储暂不可用，请使用相同请求重试', notFound: '可恢复的正文与快照均不存在' }
  )
}

async function restoreCommit(event: H3Event, uuid: string, dept: string, payload: Record<string, unknown>, plan: RestorePlan, requestKey: string) {
  // Reauthorize after the potentially slow storage phase.
  return result(await invoke(event, 'codocs.department-documents-restore', 'department-documents', 'edit', dept,
    { subId: uuid, payload: { ...payload, state_sha256: plan.state_sha256 } }, requestKey), 'uuid', uuid)
}
