/**
 * 项目文档写入的单一事实源。
 *
 * 独立 Aims 路由与企业宿主的 service 端点都调用这里，区别只在 actor uid 的
 * 来源：前者取会话 uid，后者取已验签服务命令里的 actorUid。逻辑不得在两边
 * 各写一份——本轮之前项目文档正文的来源/目标 deployment 就是因为只修了一个
 * 调用点而漏掉了另一个。
 */
import { createError, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { createCodocsDocument, deleteCodocsProjectCabinetFile } from './codocsApi'
import { buildAimsProjectListRuntimeAccessQuery, buildAimsProjectRuntimeAccessQuery } from './aimsProjectRuntimeAccess'
import { callAimsRuntime as callProjectDocumentRuntime, requireProjectDocumentDeleteAccess } from './projectDocumentAccess'

type RuntimeEnvelope<T> = { code?: number, data?: T, message?: string }
interface RuntimeProject {
  id?: number
  project_code?: string
  projectCode?: string
  dept_code?: string | null
  deptCode?: string | null
  leader_uid?: string | null
  leaderUid?: string | null
  created_by?: string | null
  createdBy?: string | null
}
interface RuntimeMember { uid?: string, role?: string, status?: string }
interface RuntimePage<T> { items?: T[] }

export interface CreateDocumentIndexBody {
  uuid?: string
  title?: string
  isFolder?: boolean | number
  is_folder?: boolean | number
  projectCode?: string | null
  project_code?: string | null
  documentSource?: string | null
  document_source?: string | null
  codocsUuid?: string | null
  codocs_uuid?: string | null
  repoProjectCode?: string | null
  repo_project_code?: string | null
  repoFilePath?: string | null
  repo_file_path?: string | null
  ossPath?: string | null
  oss_path?: string | null
  [key: string]: unknown
}

export interface CreateMarkdownDocumentBody {
  uuid?: string
  title?: string
  docCategory?: string | null
  doc_category?: string | null
  milestoneId?: number | string | null
  milestone_id?: number | string | null
  parentId?: number | string | null
  parent_id?: number | string | null
  content?: string
  folderPath?: string | null
  sourceFileName?: string | null
  source_file_name?: string | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function booleanValue(value: unknown) {
  return value === true || value === 1 || stringValue(value) === '1'
}

function nullableNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function fileExtension(fileName: string) {
  const normalized = fileName.trim().toLowerCase()
  const index = normalized.lastIndexOf('.')
  return index >= 0 ? normalized.slice(index + 1) : ''
}

function isProjectCabinetOssPath(value: string) {
  return /^codocs\/projects\/[^/]+\/cabinet\/[^/]+/.test(value)
}

function unwrapRuntimeData<T>(value: unknown): T {
  const envelope = value as RuntimeEnvelope<T>
  if (envelope && typeof envelope === 'object' && 'data' in envelope) {
    if (envelope.code !== undefined && envelope.code !== 0) {
      throw createError({ statusCode: 502, message: envelope.message || 'Aims tenant-runtime returned an error.' })
    }
    return envelope.data as T
  }
  return value as T
}

async function callAimsRuntime<T>(
  event: H3Event,
  path: string,
  options: { method?: string, query?: Record<string, unknown>, body?: Record<string, unknown>, scope?: string }
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'aims',
    scope: options.scope || (options.method && options.method !== 'GET' ? 'aims.write' : 'aims.read'),
    method: options.method || 'GET',
    query: options.query,
    body: options.body
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Aims tenant-runtime is required for project document creation.' })
  }
  return unwrapRuntimeData<T>(runtime.data)
}

function projectField(project: RuntimeProject, camel: keyof RuntimeProject, snake: keyof RuntimeProject) {
  return stringValue(project[camel] ?? project[snake])
}

function isProjectMember(project: RuntimeProject, uid: string, members: RuntimeMember[]) {
  const leaderUid = projectField(project, 'leaderUid', 'leader_uid')
  const createdBy = projectField(project, 'createdBy', 'created_by')
  if (leaderUid === uid || createdBy === uid) return true
  return members.some(member => stringValue(member.uid) === uid && (!member.status || member.status === 'active'))
}

function documentIsFolder(indexed: Record<string, unknown>, body: CreateDocumentIndexBody) {
  return booleanValue(indexed.isFolder ?? indexed.is_folder ?? body.isFolder ?? body.is_folder)
}

function hasExistingDocumentBacking(body: CreateDocumentIndexBody) {
  return Boolean(
    stringValue(body.documentSource ?? body.document_source)
    || stringValue(body.codocsUuid ?? body.codocs_uuid)
    || stringValue(body.repoProjectCode ?? body.repo_project_code)
    || stringValue(body.repoFilePath ?? body.repo_file_path)
    || stringValue(body.ossPath ?? body.oss_path)
  )
}

/** POST /api/v1/documents —— 登记文档/文件夹，必要时同步建 Codocs 文档。 */
export async function createProjectDocumentIndexEntry(event: H3Event, uid: string, body: CreateDocumentIndexBody) {
  const title = stringValue(body.title)
  if (!title) throw createError({ statusCode: 400, message: '标题不能为空' })

  const uuid = stringValue(body.uuid) || crypto.randomUUID()
  const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery(event, { uid, baseQuery: { operator_uid: uid } })
  const indexed = await callProjectDocumentRuntime<Record<string, unknown>>(event, '/v1/aims/documents', {
    method: 'POST',
    query: runtimeQuery,
    scope: 'aims.write',
    body: { ...body, uuid, title }
  })

  if (!documentIsFolder(indexed, body) && !hasExistingDocumentBacking(body)) {
    await createCodocsDocument({
      event,
      uuid,
      title,
      ownerUid: uid,
      content: '',
      docType: 'project',
      projectCode: stringValue(indexed.projectCode ?? indexed.project_code ?? body.projectCode ?? body.project_code),
      folderPath: stringValue(indexed.folderPath) || undefined
    })
  }

  return { code: 0, data: indexed }
}

async function deleteProjectCabinetBackingFile(
  event: H3Event,
  context: Awaited<ReturnType<typeof requireProjectDocumentDeleteAccess>>['context']
) {
  const isFolder = booleanValue(context.document.isFolder ?? context.document.is_folder)
  if (isFolder || context.documentRefType !== 'cabinet_file') return null

  const expectedOssPath = stringValue(
    context.document.ossPath ?? context.document.oss_path ?? context.document.repoFilePath ?? context.document.repo_file_path
  )
  if (!isProjectCabinetOssPath(expectedOssPath)) return null
  if (!context.projectCode) throw createError({ statusCode: 500, message: '项目编码缺失，无法删除项目文件' })

  return await deleteCodocsProjectCabinetFile({
    event,
    fileUuid: context.documentUuid,
    projectCode: context.projectCode,
    expectedOssPath
  })
}

/** DELETE /api/v1/documents/:id —— 文件夹由 runtime/外键级联删除子文档。 */
export async function deleteProjectDocumentEntry(event: H3Event, uid: string, docId: number) {
  if (!Number.isFinite(docId) || docId <= 0) throw createError({ statusCode: 400, message: '无效的文档 ID' })
  const { context } = await requireProjectDocumentDeleteAccess(event, docId, uid, '仅项目经理或上传人可以删除项目文档')
  const cabinetFileDelete = await deleteProjectCabinetBackingFile(event, context)

  const result = await callProjectDocumentRuntime<Record<string, unknown>>(
    event,
    `/v1/aims/documents/${encodeURIComponent(String(docId))}`,
    {
      method: 'DELETE',
      query: await buildAimsProjectListRuntimeAccessQuery(event, { uid, baseQuery: { operator_uid: uid } }),
      scope: 'aims.write'
    }
  )

  return {
    code: 0,
    message: '删除成功',
    data: result && typeof result === 'object' ? { ...result, cabinetFileDelete } : { result, cabinetFileDelete }
  }
}

/** POST /api/v1/projects/:id/markdown-documents —— Codocs 存正文，Aims 存索引。 */
export async function createProjectMarkdownDocument(event: H3Event, uid: string, projectId: number, body: CreateMarkdownDocumentBody) {
  if (!projectId || Number.isNaN(projectId)) throw createError({ statusCode: 400, message: '无效的项目ID' })
  const title = stringValue(body.title)
  if (!title) throw createError({ statusCode: 400, message: '文档标题不能为空' })
  const sourceFileName = stringValue(body.sourceFileName ?? body.source_file_name)
  if (sourceFileName && fileExtension(sourceFileName) !== 'md') {
    throw createError({ statusCode: 400, message: 'Markdown 文档仅支持 .md 文件' })
  }

  const projectAccessQuery = await buildAimsProjectRuntimeAccessQuery(event, { projectId, uid, baseQuery: { operator_uid: uid } })
  const project = await callAimsRuntime<RuntimeProject>(event, `/v1/aims/projects/${encodeURIComponent(String(projectId))}`, {
    query: projectAccessQuery,
    scope: 'aims.read'
  })
  const membersPage = await callAimsRuntime<RuntimePage<RuntimeMember>>(event, `/v1/aims/projects/${encodeURIComponent(String(projectId))}/members`, {
    query: { ...projectAccessQuery, uid, pageSize: 1 },
    scope: 'aims.read'
  })

  const members = Array.isArray(membersPage.items) ? membersPage.items : []
  const isScopedProjectAdmin = stringValue(projectAccessQuery.current_user_is_project_admin) === '1'
  if (!isScopedProjectAdmin && !isProjectMember(project, uid, members)) {
    throw createError({ statusCode: 403, message: '仅项目成员可以创建项目文档' })
  }

  const projectCode = projectField(project, 'projectCode', 'project_code')
  if (!projectCode) throw createError({ statusCode: 500, message: '项目编码缺失，无法创建项目文档' })

  const docUuid = stringValue(body.uuid) || crypto.randomUUID()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(docUuid)) throw createError({ statusCode: 400, message: '文档标识无效' })
  const milestoneId = nullableNumber(body.milestoneId ?? body.milestone_id)
  const parentId = nullableNumber(body.parentId ?? body.parent_id)
  const docCategory = stringValue(body.docCategory ?? body.doc_category) || 'general'
  const content = typeof body.content === 'string' ? body.content : ''
  const folderPath = stringValue(body.folderPath) || null

  await createCodocsDocument({
    event,
    uuid: docUuid,
    title,
    ownerUid: uid,
    content,
    docType: 'project',
    deptCode: stringValue(project.deptCode ?? project.dept_code) || undefined,
    projectCode,
    folderPath: folderPath || undefined
  })

  const indexed = await callAimsRuntime<Record<string, unknown>>(event, '/v1/aims/documents', {
    method: 'POST',
    scope: 'aims.write',
    query: projectAccessQuery,
    body: {
      uuid: docUuid,
      ...(milestoneId ? { milestoneId } : { projectId }),
      projectCode,
      parentId,
      title,
      docCategory,
      isFolder: false,
      codocsUuid: docUuid,
      documentSource: 'codocs',
      contentSize: Buffer.byteLength(content, 'utf-8')
    }
  })

  return { code: 0, data: indexed }
}
