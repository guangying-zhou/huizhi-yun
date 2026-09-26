import { createError, getHeader, getRequestURL, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { sendEnterpriseCodocsNotification } from './enterpriseCodocsNotification'
import { createRuntimeOSSClient, createRuntimeProjectsOSSClient } from '../../../codocs/server/utils/oss'

type TransferAction = 'department' | 'project'
type DirectoryNode = { deptCode?: unknown, name?: unknown, children?: unknown, managerId?: unknown, leaderId?: unknown }
type ProjectNode = { projectCode?: unknown, name?: unknown, subProjects?: unknown }
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/

function data(value: unknown) {
  return value && typeof value === 'object' && 'data' in value ? (value as { data?: unknown }).data : undefined
}
function findDepartment(nodes: unknown, code: string): DirectoryNode | undefined {
  if (!Array.isArray(nodes)) return
  for (const raw of nodes) {
    if (!raw || typeof raw !== 'object') continue
    const node = raw as DirectoryNode
    if (node.deptCode === code) return node
    const child = findDepartment(node.children, code)
    if (child) return child
  }
}
function findProject(nodes: unknown, code: string): ProjectNode | undefined {
  if (!Array.isArray(nodes)) return
  for (const raw of nodes) {
    if (!raw || typeof raw !== 'object') continue
    const node = raw as ProjectNode
    if (node.projectCode === code) return node
    const child = findProject(node.subProjects, code)
    if (child) return child
  }
}
function bodyText(value: unknown, max: number, optional = false) {
  if (value == null && optional) return null
  if (typeof value !== 'string') throw createError({ statusCode: 400, message: '文档移交字段无效' })
  const result = value.trim()
  // NUL and line breaks are rejected on purpose.
  // eslint-disable-next-line no-control-regex
  if ((!optional && !result) || [...result].length > max || /[\u0000\r\n]/.test(result)) throw createError({ statusCode: 400, message: '文档移交字段无效' })
  return result || null
}
function yjs(path: string) {
  return path.endsWith('.md') ? path.replace(/\.md$/, '.yjs') : `${path}.yjs`
}

async function copyObject(source: Awaited<ReturnType<typeof createRuntimeOSSClient>>, destination: Awaited<ReturnType<typeof createRuntimeProjectsOSSClient>>, oldPath: string, newPath: string, required: boolean, exact?: Buffer) {
  let object
  try {
    object = exact ? { content: exact } : await source.get(oldPath)
  } catch (error) {
    const missing = error as { code?: string, status?: number, statusCode?: number }
    if (!required && (missing.code === 'NoSuchKey' || missing.status === 404 || missing.statusCode === 404)) return false
    throw error
  }
  try {
    let meta: Record<string, string> = {}
    try {
      const head = await source.head(oldPath)
      meta = Object.fromEntries(Object.entries(head.meta || {}).map(([key, value]) => [key, String(value)]))
    } catch { /* metadata is optional */ }
    await destination.put(newPath, object.content, { forbidOverwrite: true, meta })
  } catch (error) {
    const conflict = error as { status?: number, statusCode?: number, code?: string }
    if (![409, 412].includes(conflict.status || conflict.statusCode || 0) && conflict.code !== 'FileAlreadyExists') throw error
    const existing = await destination.get(newPath)
    if (!Buffer.from(existing.content).equals(Buffer.from(object.content))) throw createError({ statusCode: 409, message: '目标项目已存在不同内容的同名文档' })
  }
  return true
}

export async function enterpriseCodocsDocumentTransfer(event: H3Event, action: TransferAction) {
  setHeader(event, 'Cache-Control', 'no-store')
  const uuid = String(getRouterParam(event, 'uuid') || '')
  const key = String(getHeader(event, 'idempotency-key') || '')
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(uuid) || getRequestURL(event).search || !keyPattern.test(key)) throw createError({ statusCode: 400, message: '文档移交请求无效' })
  const raw = await readBody<Record<string, unknown>>(event)
  const allowed = action === 'department' ? new Set(['deptCode', 'departmentName', 'message']) : new Set(['projectCode', 'projectName'])
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(field => !allowed.has(field))) throw createError({ statusCode: 400, message: '文档移交字段无效' })
  const targetCode = bodyText(action === 'department' ? raw.deptCode : raw.projectCode, 100) as string
  const user = await requireEnterpriseUser(event)
  const operation = `codocs.document-transfer-${action}` as const
  await prepareEnterpriseRuntime(event, operation)
  await prepareEnterpriseRuntime(event, 'codocs.personal-document-view')
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'documents', 'edit', snapshot.actionPolicies?.documents)) throw createError({ statusCode: 403, message: '缺少文档移交权限' })
  await prepareEnterpriseRuntime(event, action === 'department' ? 'console.directory-self-departments' : 'console.directory-self-projects')
  const permit = (resource: 'personal-documents' | 'document-transfer', permitAction: string) => ({ actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource, action: permitAction, expiresAt: enterpriseRuntimePermitExpiresAt() })
  const metadata = await callEnterpriseRuntime<{ success?: boolean, data?: { uuid?: string, id?: number, title?: string, owner_uid?: string, doc_type?: string, project_code?: string | null, oss_path?: string, readonly?: boolean, readonly_flag?: number } }>(event, 'codocs.personal-document-view', { tenant: user.tenant, deployment: user.deployment, code: uuid, query: {}, authorization: permit('personal-documents', 'read') })
  const doc = metadata?.data
  if (metadata?.success !== true || doc?.uuid !== uuid || typeof doc.title !== 'string' || typeof doc.owner_uid !== 'string' || typeof doc.doc_type !== 'string' || typeof doc.oss_path !== 'string') throw createError({ statusCode: 503, message: '文档移交元数据无效' })
  if (doc.owner_uid !== user.uid) throw createError({ statusCode: 403, message: '仅文档所有者可发起移交' })
  if (doc.readonly || doc.readonly_flag === 1) throw createError({ statusCode: 403, message: '只读文档不能移交' })

  if (action === 'department') {
    if (doc.doc_type !== 'private') throw createError({ statusCode: 409, message: '当前仅支持移交个人文档' })
    const directory = data(await callEnterpriseRuntime(event, 'console.directory-self-departments', {})) as { departments?: unknown, primaryDeptCode?: unknown } | undefined
    const selected = findDepartment(directory?.departments, targetCode)
    if (!selected && directory?.primaryDeptCode !== targetCode) throw createError({ statusCode: 403, message: '仅可移交到你关联的部门或委员会' })
    const message = bodyText(raw.message, 500, true)
    const response = await callEnterpriseRuntime<{ success?: boolean, data?: { shareId?: number | string } }>(event, operation, { tenant: user.tenant, deployment: user.deployment, code: uuid, payload: { dept_code: targetCode, ...(message ? { message } : {}) }, authorization: permit('document-transfer', 'department') }, { idempotencyKey: key })
    if (response?.success !== true || !/^[1-9]\d*$/.test(String(response.data?.shareId || ''))) throw createError({ statusCode: 503, message: '部门移交响应无效' })
    try {
      const recipients = [...new Set([selected?.managerId, selected?.leaderId].filter(value => typeof value === 'string' && value) as string[])]
      if (recipients.length) await sendEnterpriseCodocsNotification({ event, touser: recipients, title: '文档移交待接收', description: `${user.uid} 申请将文档《${doc.title}》移交至您的部门，请确认接收。`, url: '/codocs/departments', eventType: 'codocs.department_share.transfer_requested', category: 'document_share', severity: 'warning', bizType: 'department_share', bizId: response.data!.shareId, idempotencyKey: `codocs:department-transfer:${response.data!.shareId}`, metadata: { shareId: response.data!.shareId, documentUuid: uuid, departmentCode: targetCode, sharerUid: user.uid } })
    } catch { throw createError({ statusCode: 503, message: '移交请求已保存，通知尚未完成，请使用相同请求重试' }) }
    return { code: 0, message: 'success', data: response.data }
  }

  const projects = data(await callEnterpriseRuntime(event, 'console.directory-self-projects', {})) as { managed?: unknown, joined?: unknown } | undefined
  const selected = findProject(projects?.managed, targetCode) || findProject(projects?.joined, targetCode)
  if (!selected) throw createError({ statusCode: 403, message: '仅可移交到你参与或管理的项目组' })
  const filename = `${doc.title.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 100)}.md`
  const targetPath = `codocs/projects/${targetCode}/docs/${filename}`
  const alreadyMoved = doc.doc_type === 'project' && doc.project_code === targetCode && doc.oss_path === targetPath
  if (doc.doc_type !== 'private' && !alreadyMoved) throw createError({ statusCode: 409, message: '当前仅支持移交个人文档' })
  // A v2 document's content is its published snapshot; oss_path is only a
  // derived copy and the .yjs beside it is stale, so copy the exact bytes and
  // no collaboration state. The Runtime transfer then retires the v2 head.
  let exact: Buffer | undefined
  if (!alreadyMoved && process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 === 'true') {
    const { readSnapshotHead, readSnapshotMarkdown } = await import('./enterpriseCodocsSnapshot')
    const head = await readSnapshotHead(event, user, uuid)
    if (head.generation > 0) exact = Buffer.from(await readSnapshotMarkdown(event, head), 'utf-8')
  }
  if (!alreadyMoved) {
    try {
      const source = await createRuntimeOSSClient({ event }), destination = await createRuntimeProjectsOSSClient({ event })
      await copyObject(source, destination, doc.oss_path, targetPath, true, exact)
      if (!exact) await copyObject(source, destination, yjs(doc.oss_path), yjs(targetPath), false)
    } catch (error) {
      if ((error as { statusCode?: number })?.statusCode === 409) throw error
      throw createError({ statusCode: 503, message: '项目文档存储迁移失败，请使用相同请求重试' })
    }
  }
  const response = await callEnterpriseRuntime<{ success?: boolean, data?: Record<string, unknown> }>(event, operation, { tenant: user.tenant, deployment: user.deployment, code: uuid, payload: { project_code: targetCode, source_oss_path: doc.oss_path, new_oss_path: targetPath }, authorization: permit('document-transfer', 'project') }, { idempotencyKey: key })
  if (response?.success !== true || !response.data) throw createError({ statusCode: 503, message: '项目移交响应无效' })
  if (!alreadyMoved) {
    try {
      const source = await createRuntimeOSSClient({ event })
      await source.delete(doc.oss_path)
      try {
        await source.delete(yjs(doc.oss_path))
      } catch { /* optional snapshot */ }
    } catch { /* DB already points to the verified destination; stale source cleanup is non-authoritative. */ }
  }
  return { code: 0, message: 'success', data: { ...response.data, projectName: typeof selected.name === 'string' ? selected.name : targetCode } }
}
