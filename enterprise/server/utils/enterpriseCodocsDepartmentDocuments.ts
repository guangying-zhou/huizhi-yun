import { createHash } from 'node:crypto'
import { createError, getHeader, getQuery, getRequestURL, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'
import { withEnterpriseCodocsDocumentContent } from './enterpriseCodocsDocumentContent'

// Department documents (Codocs B1 read side + folder creation). Identity comes
// only from the verified Host session. The Runtime re-derives the department
// relation from Directory and is the final gate; nothing here is a role fact.
const departmentCode = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const idempotencyKey = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,189}$/
const documentQueryKeys = ['dept_code', 'page', 'pageSize', 'published_mode', 'exclude_weekly_reports', 'search', 'folder_id']
const folderQueryKeys = ['dept_code', 'page', 'pageSize', 'parent_id']
type Kind = 'documents' | 'folders'
type Identity = { uid: string, tenant: string, deployment: string }
type Operation = Parameters<typeof prepareEnterpriseRuntime>[1]

const reads = {
  documents: { operation: 'codocs.department-documents-list', resource: 'department-documents', keys: documentQueryKeys },
  folders: { operation: 'codocs.department-folders-list', resource: 'department-folders', keys: folderQueryKeys }
} as const

function bad(message: string) {
  return createError({ statusCode: 400, message })
}

function parseQuery(event: H3Event, allowed: readonly string[]) {
  const params = getRequestURL(event).searchParams
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(getQuery(event))) {
    // Identity-like keys (owner, viewer, actor*, marker, type) are never in the allow-list.
    if (!allowed.includes(key) || typeof value !== 'string' || params.getAll(key).length !== 1) throw bad('部门文档查询参数无效')
    result[key] = value
  }
  return result
}

function departmentOf(value: unknown) {
  if (typeof value !== 'string' || !departmentCode.test(value)) throw bad('部门编码无效')
  return value
}

function integer(raw: string | undefined, fallback: number, max: number) {
  if (raw === undefined) return fallback
  if (!/^[1-9]\d*$/.test(raw)) throw bad('分页参数无效')
  const number = Number(raw)
  if (!Number.isSafeInteger(number) || number > max) throw bad('分页参数无效')
  return number
}

function folderReference(raw: string | undefined) {
  if (raw === undefined) return undefined
  if (raw === 'null') return raw
  if (!/^[1-9]\d{0,17}$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw bad('目录标识无效')
  return raw
}

function hasControl(value: string) {
  return [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
}

async function person(event: H3Event, action: 'view' | 'create' | 'export'): Promise<Identity> {
  const user = await requireEnterpriseUser(event)
  // Console failures propagate as 503 from the snapshot loader; a missing action is 403.
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'departments', action, snapshot.actionPolicies?.departments)) {
    throw createError({ statusCode: 403, message: action === 'create' ? '缺少部门文档创建权限' : action === 'export' ? '缺少部门文档下载权限' : '缺少部门文档查看权限' })
  }
  return user
}

async function runtime<T>(event: H3Event, operation: Operation, user: Identity, resource: string, action: 'read' | 'edit' | 'create' | 'export', deptCode: string, extra: Record<string, unknown> = {}, idempotency?: string): Promise<T> {
  await prepareEnterpriseRuntime(event, operation)
  try {
    return await callEnterpriseRuntime(event, operation, {
      tenant: user.tenant, deployment: user.deployment, code: deptCode, ...extra,
      authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource, action, expiresAt: enterpriseRuntimePermitExpiresAt() }
    }, idempotency ? { idempotencyKey: idempotency } : {}) as T
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    if (status === 403) throw createError({ statusCode: 403, message: '不属于该部门或缺少操作权限', data: { code: 'department_relation_denied' } })
    if (status === 404) throw createError({ statusCode: 404, message: '部门对象不存在' })
    if (status === 400) throw bad('部门文档请求无效')
    if (status === 409) throw createError({ statusCode: 409, message: '创建请求与已有请求冲突，请刷新后重试' })
    throw createError({ statusCode: 503, message: '部门文档服务暂不可用' })
  }
}

export async function downloadEnterpriseDepartmentDocument(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const query = parseQuery(event, ['dept_code'])
  const deptCode = departmentOf(query.dept_code)
  const uuid = getRouterParam(event, 'uuid') || ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) throw bad('文档标识无效')
  const user = await person(event, 'export')
  const response = await runtime<{ success?: boolean, data?: Record<string, unknown> }>(
    event, 'codocs.department-documents-download', user, 'department-documents', 'export', deptCode, { subId: uuid })
  const doc = response?.data
  if (response?.success !== true || !doc || doc.uuid !== uuid || doc.doc_type !== 'department' || doc.dept_code !== deptCode) {
    throw createError({ statusCode: 503, message: '部门文档下载响应无效' })
  }
  const loaded = await withEnterpriseCodocsDocumentContent(event, response, uuid, false, 'export')
  const content = loaded.data as Record<string, unknown>
  // The published snapshot (once converted for collaboration) is the body, not oss_path.
  if (!content.oss_path && !(Number(content.snapshot_generation) > 0)) throw createError({ statusCode: 404, message: '文档正文不存在' })
  let filename = String(content.title || uuid).replace(/[\r\n\\/]/g, '_')
  if (!filename.toLowerCase().endsWith('.md')) filename += '.md'
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
  setHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`)
  return Buffer.from(String(content.content || ''), 'utf8')
}

const viewFields = ['id', 'uuid', 'title', 'doc_type', 'owner_uid', 'dept_code', 'project_code', 'folder_id', 'updated_at', 'readonly', 'readonly_flag', 'status', 'content', 'snapshot_generation', 'snapshot_epoch']

// Department document detail for the full document page: whitelisted metadata
// plus the exact body (published snapshot once converted, never a stale
// mirror). `department_collaboration.can_edit` is a UI hint only: Runtime
// re-derives the relation and the current member / manager rule when a
// session is requested.
export async function viewEnterpriseDepartmentDocument(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const query = parseQuery(event, ['dept_code'])
  const deptCode = departmentOf(query.dept_code)
  const uuid = getRouterParam(event, 'uuid') || ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) throw bad('文档标识无效')
  const user = await person(event, 'view')
  return await viewDepartmentDocumentFor(event, user, uuid, deptCode)
}

async function viewDepartmentDocumentFor(event: H3Event, user: Identity, uuid: string, deptCode: string) {
  const response = await runtime<{ success?: boolean, data?: Record<string, unknown> }>(
    event, 'codocs.department-documents-view', user, 'department-documents', 'read', deptCode, { subId: uuid })
  const doc = response?.data
  if (response?.success !== true || !doc || doc.uuid !== uuid || doc.doc_type !== 'department' || doc.dept_code !== deptCode) {
    throw createError({ statusCode: 503, message: '部门文档响应无效' })
  }
  const loaded = await withEnterpriseCodocsDocumentContent(event, response, uuid, false, 'view')
  const data = loaded.data as Record<string, unknown>
  const result: Record<string, unknown> = Object.fromEntries(viewFields.filter(field => field in data).map(field => [field, data[field]]))
  const { codocsDepartmentCollaborationV2Enabled } = await import('./enterpriseCodocsDepartmentCollaboration')
  if (codocsDepartmentCollaborationV2Enabled()) {
    const access = await runtime<{ success?: boolean, data?: { canWrite?: unknown, canManage?: unknown } }>(
      event, 'codocs.department-access-resolve', user, 'department-access', 'read', deptCode)
    if (access?.success !== true || typeof access.data?.canWrite !== 'boolean' || typeof access.data?.canManage !== 'boolean') {
      throw createError({ statusCode: 503, message: '部门访问响应无效' })
    }
    const editable = Number(doc.status) === 1 && !doc.readonly_flag && !doc.project_code
      && !String(doc.oss_path || '').includes('/weekly-reports/')
    result.department_collaboration = { can_edit: editable && access.data.canWrite }
  }
  return { success: true, data: result }
}

const fallbackDepartmentLimit = 50

// Entries without a department link (notifications, search, share links) reach
// the personal generic read, which Runtime denies to department members. After
// that 403 the Host tries the department read path for the caller's OWN
// departments only (Directory self-accessible list, never client input); the
// Runtime `department-documents-view` then rechecks relation R and rejects any
// department the document does not belong to (404) or the caller is not in
// (403). Every miss ends in the original personal 403, so a non-member gets
// the same answer as before and nothing about the document is revealed.
export async function resolveEnterpriseDepartmentDocumentFallback(event: H3Event, uuid: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) return null
  let user: Identity
  let codes: string[]
  try {
    user = await person(event, 'view')
    const operation = 'console.directory-self-accessible-departments' as const
    await prepareEnterpriseRuntime(event, operation)
    const response = await callEnterpriseRuntime(event, operation, {}) as { data?: unknown }
    if (!Array.isArray(response.data)) return null
    codes = [...new Set((response.data as Array<{ deptCode?: unknown }>).map(row => row?.deptCode).filter((code): code is string => typeof code === 'string' && departmentCode.test(code)))]
      .slice(0, fallbackDepartmentLimit)
  } catch { return null }
  for (const deptCode of codes) {
    try {
      return await viewDepartmentDocumentFor(event, user, uuid, deptCode)
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      if (status === 403 || status === 404) continue
      // A department where the document does exist but the service failed must
      // not be reported as a permission miss.
      throw error
    }
  }
  return null
}

function pagedData(response: { success?: boolean, data?: unknown }, message: string) {
  const data = response?.data as { items?: unknown[], total?: number, page?: number, pageSize?: number } | undefined
  if (response?.success !== true || !data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) || Number(data.total) < 0
    || !Number.isSafeInteger(data.page) || Number(data.page) < 1 || !Number.isSafeInteger(data.pageSize) || Number(data.pageSize) < 1 || Number(data.pageSize) > 200) {
    throw createError({ statusCode: 503, message })
  }
  return data as { items: unknown[], total: number, page: number, pageSize: number }
}

const documentFields = ['uuid', 'title', 'doc_type', 'owner_uid', 'dept_code', 'folder_id', 'folder_name', 'content_size', 'last_editor_uid', 'created_at', 'updated_at', 'readonly_flag']
const folderFields = ['id', 'name', 'folder_type', 'dept_code', 'parent_id', 'sort_order', 'is_open', 'created_at', 'updated_at']

// Whitelist projection: internal columns (oss_path, star/home flags) never reach the browser.
function project(item: unknown, kind: Kind, deptCode: string) {
  const row = item as Record<string, unknown>
  const valid = row && typeof row === 'object' && row.dept_code === deptCode
    && (kind === 'documents'
      ? typeof row.uuid === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(row.uuid) && row.doc_type === 'department' && typeof row.title === 'string'
      : Number.isSafeInteger(Number(row.id)) && row.folder_type === 'department' && typeof row.name === 'string')
  if (!valid) throw createError({ statusCode: 503, message: '部门文档响应无效' })
  return Object.fromEntries((kind === 'documents' ? documentFields : folderFields).filter(field => field in row).map(field => [field, row[field]]))
}

export async function listEnterpriseDepartmentItems(event: H3Event, kind: Kind) {
  setHeader(event, 'Cache-Control', 'no-store')
  const selected = reads[kind]
  const q = parseQuery(event, selected.keys)
  const deptCode = departmentOf(q.dept_code)
  const query: Record<string, string> = {
    page: String(integer(q.page, 1, 1_000_000)), pageSize: String(integer(q.pageSize, 20, 200))
  }
  if (kind === 'documents') {
    if (q.published_mode !== undefined && !['published', 'unpublished'].includes(q.published_mode)) throw bad('发布筛选无效')
    if (q.exclude_weekly_reports !== undefined && !['true', 'false'].includes(q.exclude_weekly_reports)) throw bad('周报筛选无效')
    if (q.search !== undefined && ([...q.search].length > 100 || hasControl(q.search))) throw bad('搜索关键字无效')
    for (const key of ['published_mode', 'exclude_weekly_reports', 'search'] as const) if (q[key]) query[key] = q[key]!
    const folder = folderReference(q.folder_id)
    if (folder) query.folder_id = folder
  } else {
    const parent = folderReference(q.parent_id)
    if (parent) query.parent_id = parent
  }
  const user = await person(event, 'view')
  const response = await runtime<{ success?: boolean, data?: unknown }>(event, selected.operation, user, selected.resource, 'read', deptCode, { query })
  const data = pagedData(response, '部门文档响应无效')
  return { success: true, data: { items: data.items.map(item => project(item, kind, deptCode)), total: data.total, page: data.page, pageSize: data.pageSize } }
}

export async function resolveEnterpriseDepartmentAccess(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const q = parseQuery(event, ['dept_code'])
  const deptCode = departmentOf(q.dept_code)
  const user = await person(event, 'view')
  const response = await runtime<{ success?: boolean, data?: { role?: unknown, canRead?: unknown, canWrite?: unknown, canManage?: unknown } }>(event, 'codocs.department-access-resolve', user, 'department-access', 'read', deptCode)
  const data = response?.data
  if (response?.success !== true || !data || typeof data.role !== 'string' || typeof data.canRead !== 'boolean' || typeof data.canWrite !== 'boolean' || typeof data.canManage !== 'boolean') {
    throw createError({ statusCode: 503, message: '部门访问响应无效' })
  }
  // UI hint only; the Runtime re-checks the relation on every write.
  return { success: true, data: { role: data.role, canRead: data.canRead, canWrite: data.canWrite, canManage: data.canManage } }
}

export async function createEnterpriseDepartmentFolder(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (getRequestURL(event).search) throw bad('部门目录参数无效')
  const key = getHeader(event, 'idempotency-key') || ''
  if (!idempotencyKey.test(key)) throw bad('创建目录需要有效的 Idempotency-Key')
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(field => !['dept_code', 'name', 'parent_id', 'folder_type'].includes(field))) throw bad('部门目录字段无效')
  const deptCode = departmentOf(body.dept_code)
  if (body.folder_type !== undefined && body.folder_type !== 'department') throw bad('目录类型无效')
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || [...name].length > 100 || hasControl(name)) throw bad('目录名称无效')
  let parent: number | null = null
  if (body.parent_id !== null && body.parent_id !== undefined) {
    if (typeof body.parent_id !== 'number' || !Number.isSafeInteger(body.parent_id) || body.parent_id < 1) throw bad('父目录无效')
    parent = body.parent_id
  }
  const user = await person(event, 'create')
  const payload = { folder_type: 'department', dept_code: deptCode, name, parent_id: parent }
  const response = await runtime<{ success?: boolean, data?: Record<string, unknown> }>(event, 'codocs.department-folders-create', user, 'department-folders', 'edit', deptCode, { payload }, key)
  const created = response?.data
  if (response?.success !== true || !created) throw createError({ statusCode: 503, message: '部门目录响应无效' })
  return { success: true, data: project(created, 'folders', deptCode) }
}

export async function createEnterpriseDepartmentDocument(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (getRequestURL(event).search) throw bad('部门文档创建不接受查询参数')
  const key = getHeader(event, 'idempotency-key') || ''
  if (!idempotencyKey.test(key)) throw bad('创建文档需要有效的 Idempotency-Key')
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(field => !['dept_code', 'title', 'folder_id', 'content'].includes(field))) throw bad('部门文档字段无效')
  const deptCode = departmentOf(body.dept_code)
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title || [...title].length > 255 || hasControl(title) || (body.content !== undefined && typeof body.content !== 'string')) throw bad('文档标题或正文无效')
  let folder: number | null = null
  if (body.folder_id !== undefined && body.folder_id !== null) {
    if (typeof body.folder_id !== 'number' || !Number.isSafeInteger(body.folder_id) || body.folder_id < 1) throw bad('目标目录无效')
    folder = body.folder_id
  }
  const bytes = Buffer.from(typeof body.content === 'string' ? body.content : '', 'utf8')
  if (bytes.length > 10 * 1024 * 1024) throw createError({ statusCode: 413, message: '文档正文超过 10 MiB' })
  const user = await person(event, 'create')
  return await createDepartmentDocumentFromBytes(event, user, deptCode, title, folder, bytes, key)
}

async function createDepartmentDocumentFromBytes(event: H3Event, user: Identity, deptCode: string, title: string, folder: number | null, bytes: Buffer, key: string, sourceUuid?: string) {
  const result = await runtime<{ success?: boolean, data?: { id?: number, uuid?: string, title?: string, doc_type?: string, dept_code?: string, oss_path?: string } }>(
    event, 'codocs.department-documents-create', user, 'department-documents', 'create', deptCode,
    { payload: { title, doc_type: 'department', dept_code: deptCode, folder_id: folder, content_sha256: createHash('sha256').update(bytes).digest('hex'), content_size: bytes.length, ...(sourceUuid ? { source_uuid: sourceUuid } : {}) } }, key)
  const doc = result?.data
  if (result?.success !== true || !doc || !Number.isSafeInteger(doc.id) || typeof doc.uuid !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(doc.uuid)
    || doc.title !== title || doc.doc_type !== 'department' || doc.dept_code !== deptCode
    || typeof doc.oss_path !== 'string' || !new RegExp(`^codocs/document-creations/${doc.uuid}/[0-9a-f]{64}\\.md$`).test(doc.oss_path)) {
    throw createError({ statusCode: 503, message: '部门文档创建响应无效' })
  }
  // Same sequence as personal create: the durable receipt and document row
  // precede a conditional OSS PUT. Missing body is recoverable with this key;
  // retries never overwrite a body that the editor has already changed.
  try {
    const client = await createRuntimeOSSClient({ event })
    try {
      await client.head(doc.oss_path)
      return { success: true, data: { id: doc.id, uuid: doc.uuid, title, doc_type: 'department', dept_code: deptCode } }
    } catch (error) {
      const e = error as { status?: number, statusCode?: number, code?: string }
      if (e.status !== 404 && e.statusCode !== 404 && e.code !== 'NoSuchKey') throw error
    }
    try {
      await client.put(doc.oss_path, bytes, { forbidOverwrite: true, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
    } catch (error) {
      const e = error as { status?: number, statusCode?: number, code?: string }
      if (![409, 412].includes(e.status || e.statusCode || 0) && e.code !== 'FileAlreadyExists') throw error
      await client.head(doc.oss_path)
    }
  } catch {
    throw createError({ statusCode: 503, message: '部门文档正文尚未保存，请使用相同请求重试' })
  }
  return { success: true, data: { id: doc.id, uuid: doc.uuid, title, doc_type: 'department', dept_code: deptCode } }
}

export async function copyEnterpriseDepartmentDocument(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (getRequestURL(event).search) throw bad('复制不接受查询参数')
  const key = getHeader(event, 'idempotency-key') || ''
  if (!idempotencyKey.test(key)) throw bad('复制需要有效的 Idempotency-Key')
  const sourceUuid = getRouterParam(event, 'uuid') || ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceUuid)) throw bad('源文档标识无效')
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(field => !['source_dept_code', 'dept_code', 'title', 'folder_id'].includes(field))) throw bad('复制字段无效')
  const sourceDepartment = departmentOf(body.source_dept_code)
  const targetDepartment = departmentOf(body.dept_code)
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title || [...title].length > 255 || hasControl(title)) throw bad('文档标题无效')
  let folder: number | null = null
  if (body.folder_id !== undefined && body.folder_id !== null) {
    if (typeof body.folder_id !== 'number' || !Number.isSafeInteger(body.folder_id) || body.folder_id < 1) throw bad('目标目录无效')
    folder = body.folder_id
  }
  const sourceUser = await person(event, 'view')
  const source = await runtime<{ success?: boolean, data?: Record<string, unknown> }>(
    event, 'codocs.department-documents-view', sourceUser, 'department-documents', 'read', sourceDepartment, { subId: sourceUuid })
  if (source?.success !== true || source.data?.uuid !== sourceUuid || source.data?.doc_type !== 'department'
    || source.data?.dept_code !== sourceDepartment || typeof source.data?.oss_path !== 'string') {
    throw createError({ statusCode: 503, message: '源部门文档响应无效' })
  }

  const targetUser = await person(event, 'create')
  const stageDigest = createHash('sha256').update(['codocs.department-copy.v1', targetUser.tenant, targetUser.deployment, targetUser.uid, key].join('\0')).digest('hex')
  const stagePath = `codocs/copy-staging/${stageDigest}.md`
  const intentDigest = createHash('sha256').update(JSON.stringify({ sourceUuid, sourceDepartment, targetDepartment, title, folder })).digest('hex')
  let bytes: Buffer
  try {
    const client = await createRuntimeOSSClient({ event })
    try {
      const head = await client.head(stagePath)
      if (head.meta?.['copy-intent'] !== intentDigest) throw createError({ statusCode: 409, message: '复制键已用于另一请求' })
      bytes = (await client.get(stagePath)).content
    } catch (error) {
      const e = error as { status?: number, statusCode?: number, code?: string }
      if (e.status !== 404 && e.statusCode !== 404 && e.code !== 'NoSuchKey') throw error
      const loaded = await withEnterpriseCodocsDocumentContent(event, source, sourceUuid, false)
      const content = loaded.data as Record<string, unknown>
      bytes = Buffer.from(String(content.content || ''), 'utf8')
      if (bytes.length > 10 * 1024 * 1024) throw createError({ statusCode: 413, message: '源文档正文超过 10 MiB' })
      try {
        await client.put(stagePath, bytes, { forbidOverwrite: true, meta: { 'copy-intent': intentDigest }, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
      } catch (error) {
        const conflict = error as { status?: number, statusCode?: number, code?: string }
        if (![409, 412].includes(conflict.status || conflict.statusCode || 0) && conflict.code !== 'FileAlreadyExists') throw error
        const existing = await client.head(stagePath)
        if (existing.meta?.['copy-intent'] !== intentDigest) throw createError({ statusCode: 409, message: '复制键已用于另一请求' })
        bytes = (await client.get(stagePath)).content
      }
    }
  } catch (error) {
    if ([409, 413].includes((error as { statusCode?: number }).statusCode || 0)) throw error
    throw createError({ statusCode: 503, message: '复制暂存失败，请使用相同请求重试' })
  }
  if (bytes.length > 10 * 1024 * 1024) throw createError({ statusCode: 413, message: '暂存正文超过 10 MiB' })
  return await createDepartmentDocumentFromBytes(event, targetUser, targetDepartment, title, folder, bytes, key, sourceUuid)
}
