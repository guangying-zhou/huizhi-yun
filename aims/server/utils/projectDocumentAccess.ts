import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import type { H3Event } from 'h3'
import { getDocumentOwnerContext, resolveDocumentProjectContext } from '~~/server/utils/documentOwners'
import { fetchUserDepartments } from '~~/server/utils/userDepartments'

type DocumentRefType = 'codocs_document' | 'cabinet_file'

interface RuntimeEnvelope<T> {
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

interface RuntimeProjectMember {
  uid?: string
  role?: string
  status?: string
}

interface RuntimeProjectPage {
  items?: Array<RuntimeProject>
}

interface RuntimeDocument {
  id?: number
  project_id?: number | null
  projectId?: number | null
  project_code?: string | null
  projectCode?: string | null
  work_item_id?: number | null
  workItemId?: number | null
  uuid?: string
  codocs_uuid?: string | null
  codocsUuid?: string | null
  document_source?: 'codocs' | 'repo'
  documentSource?: 'codocs' | 'repo'
}

function stringValue(value: unknown) {
  return String(value || '').trim()
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

export async function getProjectContext(event: H3Event, projectId: number, uid: string) {
  const project = await callAimsRuntime<RuntimeProject>(
    event,
    `/v1/aims/projects/${encodeURIComponent(String(projectId))}`,
    {
      query: { current_user: uid, operator_uid: uid },
      scope: 'aims.read'
    }
  )

  const membersPage = await callAimsRuntime<{ items?: RuntimeProjectMember[] }>(
    event,
    `/v1/aims/projects/${encodeURIComponent(String(projectId))}/members`,
    {
      query: { current_user: uid, operator_uid: uid, pageSize: 500 },
      scope: 'aims.read'
    }
  )

  const members = Array.isArray(membersPage.items) ? membersPage.items : []
  const member = members.find(item => stringValue(item.uid) === uid && (!item.status || item.status === 'active'))
  const leaderUid = projectField(project, 'leaderUid', 'leader_uid')
  const createdBy = projectField(project, 'createdBy', 'created_by')
  const isManager = leaderUid === uid || createdBy === uid || member?.role === 'manager'
  const isMember = Boolean(member) || isManager

  const projectList = await callAimsRuntime<RuntimeProjectPage>(
    event,
    '/v1/aims/projects',
    {
      query: { current_user: uid, operator_uid: uid, pageSize: 500 },
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
    const userDepartments = await fetchUserDepartments(uid)
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
    actorProjectCodes,
    actorDeptCodes: [...actorDeptCodes],
    actorRoles: isManager ? ['project_manager'] : (isMember ? ['project_member'] : ['employee'])
  }
}

export async function getProjectDocumentContext(event: H3Event, projectId: number, documentId: number, uid: string) {
  const projectContext = await getProjectContext(event, projectId, uid)
  const document = await callAimsRuntime<RuntimeDocument>(
    event,
    `/v1/aims/documents/${encodeURIComponent(String(documentId))}`,
    {
      query: { current_user: uid, operator_uid: uid },
      scope: 'aims.read'
    }
  )

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

export async function requireProjectDocumentMember(
  event: H3Event,
  documentId: number,
  uid: string,
  message = '仅项目成员可以操作项目文档'
) {
  const owner = await getDocumentOwnerContext(documentId)
  if (!owner) {
    throw createError({ statusCode: 404, message: '文档不存在' })
  }

  const projectOwner = await resolveDocumentProjectContext(owner)
  if (!projectOwner.projectId) {
    throw createError({ statusCode: 403, message })
  }

  const context = await getProjectDocumentContext(event, projectOwner.projectId, documentId, uid)
  if (!context.isMember) {
    throw createError({ statusCode: 403, message })
  }

  return {
    owner,
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
