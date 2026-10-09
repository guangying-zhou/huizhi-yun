import { createHash } from 'node:crypto'
import { createError, getHeader, getQuery, getRequestURL, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'
import { parseSnapshotHead, saveSnapshotWith, type SnapshotHead } from './enterpriseCodocsSnapshot'
import { readLegacyMarkdown } from './enterpriseCodocsDocumentContent'

// Department document real-time collaboration, Host side
// (docs/Codocs-Host-Department-Collaboration-Design.md). The Host only asks
// Runtime: it sends no relation, role or object-type facts. Runtime re-derives
// the department relation from Directory and is the final authority; the
// person permission checked here (departments:edit / departments:view) is a
// quick refusal. Off unless snapshot v2, collaboration v2 and the separate
// department switch are all "true" (the Runtime routes register only then).

type EnterpriseUser = Awaited<ReturnType<typeof requireEnterpriseUser>>
type Permission = 'view' | 'edit' | 'export'

const openOperation = 'codocs.department-documents-collaboration-open' as const
const readOperation = 'codocs.department-documents-snapshot-read' as const
const prepareOperation = 'codocs.department-documents-snapshot-prepare' as const
const publishOperation = 'codocs.department-documents-snapshot-publish' as const
const viewOperation = 'codocs.department-documents-view' as const

const departmentPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CONVERSION_BYTES = 10 * 1024 * 1024
// No presence signal exists for a legacy (v1) Collab room, so recent activity
// is the proxy: a save writes the Markdown mirror, the .yjs sidecar and bumps
// updated_at. Anything newer than this window refuses the conversion.
export const V1_COLLABORATION_QUIET_MS = 120_000

export function codocsDepartmentCollaborationV2Enabled() {
  return process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 === 'true'
    && process.env.HZY_ENTERPRISE_CODOCS_COLLABORATION_V2 === 'true'
    && process.env.HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2 === 'true'
}

function bad(message: string) {
  return createError({ statusCode: 400, message, data: { code: 'department_collaboration_request_invalid' } })
}

function requireEnabled() {
  if (!codocsDepartmentCollaborationV2Enabled()) {
    throw createError({ statusCode: 404, message: '部门文档协作未启用', data: { code: 'department_collaboration_disabled' } })
  }
}

// Ticket and conversion requests carry no body and only the department code.
// Reject them from framing headers before Nitro buffers anything.
function parseRequest(event: H3Event) {
  const uuid = String(getRouterParam(event, 'uuid') || '')
  if (!uuidPattern.test(uuid)) throw bad('文档标识无效')
  const params = getRequestURL(event).searchParams
  const query = getQuery(event)
  if (Object.keys(query).some(key => key !== 'dept_code') || params.getAll('dept_code').length !== 1) throw bad('部门文档协作请求无效')
  const deptCode = query.dept_code
  if (typeof deptCode !== 'string' || !departmentPattern.test(deptCode)) throw bad('部门编码无效')
  const contentLength = getHeader(event, 'content-length')
  if ((contentLength && contentLength !== '0') || getHeader(event, 'transfer-encoding')) throw bad('部门文档协作请求无效')
  return { uuid: uuid.toLowerCase(), deptCode }
}

// Console failures propagate as 503 from the snapshot loader; a missing action is 403.
async function requirePerson(event: H3Event, user: EnterpriseUser, permission: Permission) {
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'departments', permission, snapshot.actionPolicies?.departments)) {
    throw createError({ statusCode: 403, message: permission === 'edit' ? '缺少部门文档编辑权限' : permission === 'export' ? '缺少部门文档下载权限' : '缺少部门文档查看权限' })
  }
}

// Token acquisition first, then the current person authorization, then the
// short permit: a slow token exchange never ages the permit or the decision.
async function permit(event: H3Event, user: EnterpriseUser, operation: Parameters<typeof prepareEnterpriseRuntime>[1], permission: Permission, action: 'read' | 'edit') {
  await prepareEnterpriseRuntime(event, operation)
  await requirePerson(event, user, permission)
  return { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'department-documents', action, expiresAt: enterpriseRuntimePermitExpiresAt() }
}

// Published head of a department document, for exact-version body reads.
// Generation 0 means the document has not been converted and reads from its path.
export async function readDepartmentSnapshotHead(event: H3Event, user: EnterpriseUser, deptCode: string, uuid: string, permission: 'view' | 'export' = 'view'): Promise<SnapshotHead> {
  if (!departmentPattern.test(deptCode) || !uuidPattern.test(uuid)) throw createError({ statusCode: 503, message: '部门文档快照引用无效' })
  const response = await callEnterpriseRuntime<{ success?: boolean, data?: Record<string, unknown> }>(event, readOperation, {
    tenant: user.tenant, deployment: user.deployment, code: deptCode, subId: uuid,
    authorization: await permit(event, user, readOperation, permission, 'read')
  })
  if (response?.success !== true) throw createError({ statusCode: 503, message: '文档快照引用无效' })
  return parseSnapshotHead(response.data)
}

export async function enterpriseCodocsDepartmentCollaborationOpen(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  requireEnabled()
  const { uuid, deptCode } = parseRequest(event)
  const user = await requireEnterpriseUser(event)
  const response = await callEnterpriseRuntime<{ success?: boolean, data?: { sessionId?: unknown, ticket?: unknown, expiresAt?: unknown, generation?: unknown, epoch?: unknown } }>(event, openOperation, {
    tenant: user.tenant, deployment: user.deployment, code: deptCode, subId: uuid,
    authorization: await permit(event, user, openOperation, 'edit', 'edit')
  })
  const data = response?.data
  if (response?.success !== true || typeof data?.sessionId !== 'string' || typeof data.ticket !== 'string' || !/^[a-f0-9]{64}$/.test(data.ticket)) {
    throw createError({ statusCode: 503, message: '协作会话响应无效' })
  }
  // One-time ticket for this verified user; Runtime stored only its hash.
  return { success: true, data: { token: `v2.${data.ticket}`, sessionId: data.sessionId, expiresAt: data.expiresAt, generation: data.generation } }
}

function convertible(doc: Record<string, unknown>, deptCode: string, uuid: string) {
  const path = typeof doc.oss_path === 'string' ? doc.oss_path : ''
  // Only live Markdown department documents: no archived (status 2) published
  // copies, weekly reports, projects, or any other document type.
  return doc.uuid === uuid && doc.doc_type === 'department' && doc.dept_code === deptCode && Number(doc.status) === 1
    && !doc.project_code && !doc.readonly_flag && path.endsWith('.md') && !path.includes('/weekly-reports/') && !path.startsWith('recycle.bin/')
}

function refuse(status: number, code: string, message: string): never {
  throw createError({ statusCode: status, message, data: { code } })
}

export async function assertNoActiveLegacyCollaboration(event: H3Event, doc: Record<string, unknown>) {
  const quietAfter = Date.now() - V1_COLLABORATION_QUIET_MS
  const updated = Date.parse(String(doc.updated_at ?? ''))
  // Unparseable freshness cannot prove the room is idle: fail closed.
  if (!Number.isFinite(updated) || updated > quietAfter) refuse(409, 'document_v1_collaboration_active', '文档近期有协作编辑，请稍后再试')
  const path = String(doc.oss_path)
  let modified: number | null = null
  try {
    const client = await createRuntimeOSSClient({ event })
    const head = await client.head(`${path.slice(0, -3)}.yjs`)
    const header = (head.res?.headers as Record<string, string> | undefined)?.['last-modified']
    modified = header ? Date.parse(header) : Number.NaN
  } catch (error) {
    const missing = error as { status?: number, statusCode?: number, code?: string }
    if (missing.status !== 404 && missing.statusCode !== 404 && missing.code !== 'NoSuchKey') {
      throw createError({ statusCode: 503, message: '文档存储暂不可用', data: { code: 'enterprise_document_storage_unavailable' } })
    }
  }
  if (modified !== null && (!Number.isFinite(modified) || modified > quietAfter)) refuse(409, 'document_v1_collaboration_active', '文档近期有协作编辑，请稍后再试')
}

// Explicit "协作编辑" intent for a department document that is still v1:
// publishes the current Markdown as generation 1 (CAS from generation 0), so a
// session can then be opened. Reading a document never reaches this path.
export async function enterpriseCodocsDepartmentCollaborationConvert(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  requireEnabled()
  const { uuid, deptCode } = parseRequest(event)
  const user = await requireEnterpriseUser(event)
  await requirePerson(event, user, 'edit')

  const view = await callEnterpriseRuntime<{ success?: boolean, data?: Record<string, unknown> }>(event, viewOperation, {
    tenant: user.tenant, deployment: user.deployment, code: deptCode, subId: uuid,
    authorization: await permit(event, user, viewOperation, 'edit', 'read')
  })
  const doc = view?.data
  if (view?.success !== true || !doc || doc.uuid !== uuid) throw createError({ statusCode: 503, message: '部门文档响应无效' })
  if (!convertible(doc, deptCode, uuid)) refuse(409, 'department_document_not_convertible', '该文档不支持协作编辑')

  const head = await readDepartmentSnapshotHead(event, user, deptCode, uuid, 'view')
  if (head.generation > 0) return { success: true, data: { converted: true, generation: head.generation, epoch: head.epoch, replayed: true } }
  await assertNoActiveLegacyCollaboration(event, doc)

  const markdown = await readLegacyMarkdown(event, String(doc.oss_path), 'department')
  const bytes = Buffer.from(markdown, 'utf8')
  if (bytes.length > MAX_CONVERSION_BYTES) throw createError({ statusCode: 413, message: '文档正文超过 10 MiB，无法转为协作文档' })
  // Stable per user intent: the same person converting the same body at the
  // same base retries the same command; another person's click is another
  // command and loses (or wins) the generation 0 -> 1 compare-and-swap.
  const key = `dept-convert:${createHash('sha256').update(['codocs.department-convert.v1', user.tenant, user.deployment, user.uid, uuid, head.epoch, 0, createHash('sha256').update(bytes).digest('hex')].join('\0')).digest('hex')}`
  const target = {
    prepareOperation, publishOperation, route: { code: deptCode, subId: uuid },
    permit: (operation: Parameters<typeof prepareEnterpriseRuntime>[1]) => permit(event, user, operation, 'edit', 'edit')
  }
  try {
    const saved = await saveSnapshotWith(event, user, target, key, bytes, { expectedGeneration: 0, expectedEpoch: head.epoch })
    return { success: true, data: { converted: true, generation: saved.generation, epoch: head.epoch, replayed: saved.replayed } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode !== 409) throw error
    // Lost the race to another converter: re-read, and join if it is v2 now.
    const current = await readDepartmentSnapshotHead(event, user, deptCode, uuid, 'view')
    if (current.generation > 0) return { success: true, data: { converted: true, generation: current.generation, epoch: current.epoch, replayed: true } }
    throw error
  }
}
