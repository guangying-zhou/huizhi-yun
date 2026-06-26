/**
 * POST /api/v1/projects/:id/markdown-documents
 *
 * Creates a Codocs Markdown document and registers it in Aims project_documents
 * through tenant-runtime. Aims keeps project/milestone indexing; Codocs owns
 * document content and collaboration.
 */
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import type { H3Event } from 'h3'
import { createCodocsDocument } from '~~/server/utils/codocsApi'
import { buildAimsProjectRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'

type RuntimeEnvelope<T> = {
  code?: number
  data?: T
  message?: string
}

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

interface RuntimeMember {
  uid?: string
  role?: string
  status?: string
}

interface RuntimePage<T> {
  items?: T[]
}

interface CreateMarkdownBody {
  title?: string
  docCategory?: string | null
  doc_category?: string | null
  milestoneId?: number | string | null
  milestone_id?: number | string | null
  parentId?: number | string | null
  parent_id?: number | string | null
  content?: string
  folderPath?: string | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function nullableNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
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
  options: {
    method?: string
    query?: Record<string, unknown>
    body?: Record<string, unknown>
    scope?: string
  }
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'aims',
    scope: options.scope || (options.method && options.method !== 'GET' ? 'aims.write' : 'aims.read'),
    method: options.method || 'GET',
    query: options.query,
    body: options.body
  })

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Aims tenant-runtime is required for project document creation.'
    })
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

  return members.some(member =>
    stringValue(member.uid) === uid
    && (!member.status || member.status === 'active')
  )
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const projectId = Number(getRouterParam(event, 'id'))
  if (!projectId || Number.isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const body = await readBody<CreateMarkdownBody>(event)
  const title = stringValue(body.title)
  if (!title) {
    throw createError({ statusCode: 400, message: '文档标题不能为空' })
  }

  const projectAccessQuery = await buildAimsProjectRuntimeAccessQuery(event, {
    projectId,
    uid,
    baseQuery: { operator_uid: uid }
  })

  const project = await callAimsRuntime<RuntimeProject>(
    event,
    `/v1/aims/projects/${encodeURIComponent(String(projectId))}`,
    {
      query: projectAccessQuery,
      scope: 'aims.read'
    }
  )

  const membersPage = await callAimsRuntime<RuntimePage<RuntimeMember>>(
    event,
    `/v1/aims/projects/${encodeURIComponent(String(projectId))}/members`,
    {
      query: {
        ...projectAccessQuery,
        uid,
        pageSize: 1
      },
      scope: 'aims.read'
    }
  )

  const members = Array.isArray(membersPage.items) ? membersPage.items : []
  const isScopedProjectAdmin = stringValue(projectAccessQuery.current_user_is_project_admin) === '1'
  if (!isScopedProjectAdmin && !isProjectMember(project, uid, members)) {
    throw createError({ statusCode: 403, message: '仅项目成员可以创建项目文档' })
  }

  const projectCode = projectField(project, 'projectCode', 'project_code')
  if (!projectCode) {
    throw createError({ statusCode: 500, message: '项目编码缺失，无法创建项目文档' })
  }

  const docUuid = crypto.randomUUID()
  const milestoneId = nullableNumber(body.milestoneId ?? body.milestone_id)
  const parentId = nullableNumber(body.parentId ?? body.parent_id)
  const docCategory = stringValue(body.docCategory ?? body.doc_category) || 'general'
  const content = typeof body.content === 'string' ? body.content : ''
  const folderPath = stringValue(body.folderPath) || null

  await createCodocsDocument({
    uuid: docUuid,
    title,
    ownerUid: uid,
    content,
    docType: 'project',
    deptCode: stringValue(project.deptCode ?? project.dept_code) || undefined,
    projectCode,
    folderPath: folderPath || undefined
  })

  const indexed = await callAimsRuntime<Record<string, unknown>>(
    event,
    '/v1/aims/documents',
    {
      method: 'POST',
      scope: 'aims.write',
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
        contentSize: Buffer.byteLength(content, 'utf-8'),
        current_user: uid,
        operator_uid: uid
      }
    }
  )

  return {
    code: 0,
    data: indexed
  }
})
