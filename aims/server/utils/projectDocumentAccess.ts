import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import type { H3Event } from 'h3'
import {
  buildAimsProjectListRuntimeAccessQuery,
  buildAimsProjectRuntimeAccessQuery
} from './aimsProjectRuntimeAccess'
import { fetchUserDepartments } from './userDepartments'

type DocumentRefType = 'codocs_document' | 'cabinet_file'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface RuntimeProject {
  id?: number
  category?: string
  repos?: RuntimeProjectRepo[]
  project_code?: string
  projectCode?: string
  dept_code?: string | null
  deptCode?: string | null
  leader_uid?: string | null
  leaderUid?: string | null
  created_by?: string | null
  createdBy?: string | null
}

interface RuntimeProjectMember {
  uid?: string
  role?: string
  status?: string
}

interface RuntimeProjectRepo {
  repo_project_code?: string | null
  repoProjectCode?: string | null
}

interface RuntimeProjectPage {
  items?: Array<RuntimeProject>
}

interface RuntimeDocument {
  id?: number
  title?: string | null
  portfolio_id?: number | null
  portfolioId?: number | null
  project_id?: number | null
  projectId?: number | null
  project_code?: string | null
  projectCode?: string | null
  milestone_id?: number | null
  milestoneId?: number | null
  work_item_id?: number | null
  workItemId?: number | null
  uuid?: string
  codocs_uuid?: string | null
  codocsUuid?: string | null
  document_source?: 'codocs' | 'repo'
  documentSource?: 'codocs' | 'repo'
  repo_file_path?: string | null
  repoFilePath?: string | null
  oss_path?: string | null
  ossPath?: string | null
  is_folder?: number | boolean | null
  isFolder?: boolean | null
  created_by?: string | null
  createdBy?: string | null
}

interface RuntimeDeliverable {
  document_uuid?: string | null
  documentUuid?: string | null
  document_title?: string | null
  documentTitle?: string | null
  name?: string | null
}

interface RuntimeProjectOwnedRecord {
  project_id?: number | null
  projectId?: number | null
}

interface RuntimePage<T> {
  items?: T[]
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function booleanValue(value: unknown) {
  return value === true || value === 1 || stringValue(value) === '1'
}

function normalizeItems<T>(data: RuntimePage<T> | T[] | null | undefined) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  return []
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

export async function callAimsRuntime<T>(
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
      message: 'Aims tenant-runtime is required for document access control.'
    })
  }

  return unwrapRuntimeData<T>(runtime.data)
}

export function projectField(project: RuntimeProject, camel: keyof RuntimeProject, snake: keyof RuntimeProject) {
  return stringValue(project[camel] ?? project[snake])
}

async function buildRuntimeFactAccessQuery(event: H3Event, uid: string) {
  return await buildAimsProjectListRuntimeAccessQuery(event, {
    uid,
    baseQuery: { operator_uid: uid }
  })
}

async function getRuntimeDocument(event: H3Event, documentId: number, uid: string) {
  return await callAimsRuntime<RuntimeDocument>(
    event,
    `/v1/aims/documents/${encodeURIComponent(String(documentId))}`,
    {
      query: await buildRuntimeFactAccessQuery(event, uid),
      scope: 'aims.read'
    }
  )
}

async function getRuntimeProjectOwnedRecord(event: H3Event, path: string, uid: string) {
  return await callAimsRuntime<RuntimeProjectOwnedRecord>(
    event,
    path,
    {
      query: await buildRuntimeFactAccessQuery(event, uid),
      scope: 'aims.read'
    }
  )
}

async function resolveRuntimeDocumentProjectId(event: H3Event, document: RuntimeDocument, uid: string) {
  const directProjectId = Number(document.projectId ?? document.project_id) || null
  if (directProjectId) return directProjectId

  const milestoneId = Number(document.milestoneId ?? document.milestone_id) || null
  if (milestoneId) {
    const milestone = await getRuntimeProjectOwnedRecord(
      event,
      `/v1/aims/milestones/${encodeURIComponent(String(milestoneId))}`,
      uid
    )
    return Number(milestone.projectId ?? milestone.project_id) || null
  }

  const workItemId = Number(document.workItemId ?? document.work_item_id) || null
  if (workItemId) {
    const workItem = await getRuntimeProjectOwnedRecord(
      event,
      `/v1/aims/work-items/${encodeURIComponent(String(workItemId))}`,
      uid
    )
    return Number(workItem.projectId ?? workItem.project_id) || null
  }

  return null
}

export async function getProjectContext(event: H3Event, projectId: number, uid: string) {
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

  const membersPage = await callAimsRuntime<{ items?: RuntimeProjectMember[] }>(
    event,
    `/v1/aims/projects/${encodeURIComponent(String(projectId))}/members`,
    {
      query: { ...projectAccessQuery, pageSize: 500 },
      scope: 'aims.read'
    }
  )

  const members = Array.isArray(membersPage.items) ? membersPage.items : []
  const member = members.find(item => stringValue(item.uid) === uid && (!item.status || item.status === 'active'))
  const leaderUid = projectField(project, 'leaderUid', 'leader_uid')
  const createdBy = projectField(project, 'createdBy', 'created_by')
  const isScopedProjectAdmin = projectAccessQuery.current_user_is_project_admin === '1'
  const isManager = leaderUid === uid || createdBy === uid || member?.role === 'manager' || isScopedProjectAdmin
  const isMember = Boolean(member) || isManager

  const projectList = await callAimsRuntime<RuntimeProjectPage>(
    event,
    '/v1/aims/projects',
    {
      query: await buildAimsProjectListRuntimeAccessQuery(event, {
        uid,
        baseQuery: { operator_uid: uid, pageSize: 500 }
      }),
      scope: 'aims.read'
    }
  )

  const actorProjectCodes = Array.isArray(projectList.items)
    ? projectList.items
        .map(item => projectField(item, 'projectCode', 'project_code'))
        .filter(Boolean)
    : []

  const projectCode = projectField(project, 'projectCode', 'project_code')
  if (projectCode && !actorProjectCodes.includes(projectCode) && isMember) {
    actorProjectCodes.push(projectCode)
  }

  const deptCode = projectField(project, 'deptCode', 'dept_code')
  const actorDeptCodes = new Set<string>()
  try {
    const userDepartments = await fetchUserDepartments(event, uid)
    if (userDepartments.primaryDeptCode) actorDeptCodes.add(userDepartments.primaryDeptCode)
    for (const code of userDepartments.managedDeptCodes || []) {
      if (code) actorDeptCodes.add(code)
    }
  } catch {
    if (deptCode) actorDeptCodes.add(deptCode)
  }

  return {
    project,
    projectCode,
    deptCode,
    isMember,
    isManager,
    isScopedProjectAdmin,
    actorProjectCodes,
    actorDeptCodes: [...actorDeptCodes],
    actorRoles: isManager ? ['project_manager'] : (isMember ? ['project_member'] : ['employee'])
  }
}

/**
 * Git integration uses an application credential. Bind legacy Account-named
 * Git document routes to both an Aims project the current user may access and
 * an exact repository relation from tenant-runtime before invoking it.
 */
export async function assertAimsProjectRepositoryAccess(
  event: H3Event,
  projectId: number,
  repoProjectCode: string,
  uid: string
) {
  const normalizedRepoProjectCode = stringValue(repoProjectCode)
  if (!Number.isInteger(projectId) || projectId <= 0 || !normalizedRepoProjectCode) {
    throw createError({ statusCode: 400, message: '项目和仓库编码为必填项' })
  }

  const projectContext = await getProjectContext(event, projectId, uid)
  if (!projectContext.isMember) {
    throw createError({ statusCode: 403, message: '无权访问该项目仓库' })
  }

  const projectAccessQuery = await buildAimsProjectRuntimeAccessQuery(event, {
    projectId,
    uid,
    baseQuery: { operator_uid: uid }
  })
  const repos = await callAimsRuntime<RuntimePage<RuntimeProjectRepo>>(
    event,
    `/v1/aims/projects/${encodeURIComponent(String(projectId))}/repos`,
    {
      query: { ...projectAccessQuery, pageSize: 500 },
      scope: 'aims.read'
    }
  )
  const isLinked = normalizeItems(repos).some(item => (
    stringValue(item.repoProjectCode ?? item.repo_project_code) === normalizedRepoProjectCode
  ))
  if (!isLinked) {
    throw createError({ statusCode: 403, message: '该仓库未关联到当前项目' })
  }

  return projectContext
}

export async function assertCodocsProjectDocumentAccess(event: H3Event, projectId: number, uuid: string, uid: string) {
  const projectAccessQuery = await buildAimsProjectRuntimeAccessQuery(event, {
    projectId,
    uid,
    baseQuery: { operator_uid: uid }
  })
  const [project, membersPage] = await Promise.all([
    callAimsRuntime<RuntimeProject>(
      event,
      `/v1/aims/projects/${encodeURIComponent(String(projectId))}`,
      {
        query: projectAccessQuery,
        scope: 'aims.read'
      }
    ),
    callAimsRuntime<RuntimePage<RuntimeProjectMember>>(
      event,
      `/v1/aims/projects/${encodeURIComponent(String(projectId))}/members`,
      {
        query: { ...projectAccessQuery, pageSize: 100 },
        scope: 'aims.read'
      }
    )
  ])

  const members = normalizeItems(membersPage)
  const member = members.find(item => stringValue(item.uid) === uid && (!item.status || item.status === 'active'))
  const leaderUid = projectField(project, 'leaderUid', 'leader_uid')
  const createdBy = projectField(project, 'createdBy', 'created_by')
  const isScopedProjectAdmin = projectAccessQuery.current_user_is_project_admin === '1'
  if (!member && leaderUid !== uid && createdBy !== uid && !isScopedProjectAdmin) {
    throw createError({ statusCode: 403, message: '仅项目成员可查看项目文档' })
  }

  const documentRequests = [
    callAimsRuntime<RuntimePage<RuntimeDocument> | RuntimeDocument[]>(
      event,
      '/v1/aims/documents',
      {
        query: {
          ...projectAccessQuery,
          project_id: projectId,
          codocs_uuid: uuid,
          pageSize: 1
        },
        scope: 'aims.read'
      }
    )
  ]

  const projectCode = projectField(project, 'projectCode', 'project_code')
  if (projectCode) {
    documentRequests.push(
      callAimsRuntime<RuntimePage<RuntimeDocument> | RuntimeDocument[]>(
        event,
        '/v1/aims/documents',
        {
          query: {
            ...projectAccessQuery,
            project_code: projectCode,
            codocs_uuid: uuid,
            pageSize: 1
          },
          scope: 'aims.read'
        }
      )
    )
  }

  const [documentPages, deliverablesPage] = await Promise.all([
    Promise.all(documentRequests),
    callAimsRuntime<RuntimePage<RuntimeDeliverable> | RuntimeDeliverable[]>(
      event,
      '/v1/aims/deliverables',
      {
        query: {
          ...projectAccessQuery,
          project_id: projectId,
          deliverable_type: 'document',
          document_uuid: uuid,
          pageSize: 1
        },
        scope: 'aims.read'
      }
    )
  ])

  for (const page of documentPages) {
    const doc = normalizeItems(page).find(item => stringValue(item.codocsUuid ?? item.codocs_uuid) === uuid)
    if (doc) {
      return {
        projectCode,
        title: stringValue(doc.title)
      }
    }
  }

  const deliverable = normalizeItems(deliverablesPage)
    .find(item => stringValue(item.documentUuid ?? item.document_uuid) === uuid)
  if (deliverable) {
    return {
      projectCode,
      title: stringValue(deliverable.documentTitle ?? deliverable.document_title)
        || stringValue(deliverable.name)
    }
  }

  throw createError({ statusCode: 403, message: '该文档未关联到当前项目' })
}

export async function getProjectDocumentContext(event: H3Event, projectId: number, documentId: number, uid: string) {
  const projectContext = await getProjectContext(event, projectId, uid)
  const document = await getRuntimeDocument(event, documentId, uid)

  const docProjectId = Number(document.projectId ?? document.project_id) || null
  const docProjectCode = stringValue(document.projectCode ?? document.project_code)
  const belongsToProject = docProjectId === projectId
    || (docProjectCode && docProjectCode === projectContext.projectCode)

  if (!belongsToProject) {
    throw createError({ statusCode: 404, message: '项目文档不存在' })
  }

  const documentSource = (document.documentSource ?? document.document_source ?? 'codocs') as 'codocs' | 'repo'
  const codocsUuid = stringValue(document.codocsUuid ?? document.codocs_uuid)
  const uuid = stringValue(document.uuid)

  const documentRefType: DocumentRefType = documentSource === 'codocs' ? 'codocs_document' : 'cabinet_file'
  const documentUuid = documentRefType === 'codocs_document' ? (codocsUuid || uuid) : uuid
  if (!documentUuid) {
    throw createError({ statusCode: 400, message: '文档索引缺少可用的文档 UUID' })
  }

  return {
    ...projectContext,
    documentId,
    document,
    documentRefType,
    documentUuid
  }
}

export async function requireProjectDocumentDeleteAccess(
  event: H3Event,
  documentId: number,
  uid: string,
  message = '仅项目经理或上传人可以删除项目文档'
) {
  const document = await getRuntimeDocument(event, documentId, uid)
  if (!document || !document.id) {
    throw createError({ statusCode: 404, message: '文档不存在' })
  }

  const projectId = await resolveRuntimeDocumentProjectId(event, document, uid)
  if (!projectId) {
    throw createError({ statusCode: 403, message })
  }

  const context = await getProjectDocumentContext(event, projectId, documentId, uid)
  const createdBy = stringValue(context.document.createdBy ?? context.document.created_by)
  const isFolder = booleanValue(context.document.isFolder ?? context.document.is_folder)
  if (!context.isManager && (isFolder || createdBy !== uid)) {
    throw createError({ statusCode: 403, message })
  }

  return {
    context
  }
}

export function buildAccessSummary(input: {
  lifecycleStage: string
  confidentialityLevel: string
  allowInternalAccess: boolean
  allowCrossProject: boolean
  grantCount: number
}) {
  if (input.lifecycleStage === 'draft') return '草稿，仅项目成员'
  if (input.confidentialityLevel === 'L3') return `机密，白名单 ${input.grantCount} 项`
  if (input.allowInternalAccess && (input.confidentialityLevel === 'L0' || input.confidentialityLevel === 'L1')) {
    return '企业内部可查看'
  }
  if (input.allowCrossProject) return `已授权 ${input.grantCount} 项`
  return '仅项目成员'
}
