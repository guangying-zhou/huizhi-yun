import { checkCodocsDocumentAccess, getCodocsDocumentAccessPolicy, updateCodocsDocumentAccessPolicy } from '~~/server/utils/codocsApi'
import { callAimsRuntime, getProjectContext } from '~~/server/utils/projectDocumentAccess'

type DocumentRefType = 'codocs_document' | 'cabinet_file'

interface RuntimePage<T> {
  items?: T[]
}

interface RuntimeDocument {
  id?: number
  uuid?: string
  title?: string
  project_id?: number | null
  projectId?: number | null
  project_code?: string | null
  projectCode?: string | null
  milestone_id?: number | null
  milestoneId?: number | null
  work_item_id?: number | null
  workItemId?: number | null
  parent_id?: number | null
  parentId?: number | null
  doc_category?: string | null
  docCategory?: string | null
  is_folder?: boolean | number
  isFolder?: boolean | number
  codocs_uuid?: string | null
  codocsUuid?: string | null
  document_source?: 'codocs' | 'repo'
  documentSource?: 'codocs' | 'repo'
  repo_project_code?: string | null
  repoProjectCode?: string | null
  repo_file_path?: string | null
  repoFilePath?: string | null
  repo_commit_id?: string | null
  repoCommitId?: string | null
  oss_path?: string | null
  ossPath?: string | null
  content_size?: number | null
  contentSize?: number | null
  created_by?: string | null
  createdBy?: string | null
  created_at?: string | null
  createdAt?: string | null
  updated_at?: string | null
  updatedAt?: string | null
  sort_order?: number | null
  sortOrder?: number | null
  access_lifecycle_stage?: 'draft' | 'formal' | 'archived' | null
  accessLifecycleStage?: 'draft' | 'formal' | 'archived' | null
  access_confidentiality_level?: 'L0' | 'L1' | 'L2' | 'L3' | null
  accessConfidentialityLevel?: 'L0' | 'L1' | 'L2' | 'L3' | null
  access_summary?: string | null
  accessSummary?: string | null
  virtual?: boolean
  virtualSource?: 'deliverable'
}

interface RuntimeDeliverable {
  id?: number
  target_id?: number | null
  targetId?: number | null
  matter_id?: number | null
  matterId?: number | null
  name?: string | null
  deliverable_type?: string | null
  deliverableType?: string | null
  status?: string | null
  document_uuid?: string | null
  documentUuid?: string | null
  document_title?: string | null
  documentTitle?: string | null
  document_source?: 'codocs' | 'repo' | null
  documentSource?: 'codocs' | 'repo' | null
  repo_project_code?: string | null
  repoProjectCode?: string | null
  repo_file_path?: string | null
  repoFilePath?: string | null
  repo_commit_id?: string | null
  repoCommitId?: string | null
  submitted_by?: string | null
  submittedBy?: string | null
  submitted_at?: string | null
  submittedAt?: string | null
  updated_at?: string | null
  updatedAt?: string | null
  project_id?: number | null
  projectId?: number | null
  project_code?: string | null
  projectCode?: string | null
}

interface RuntimeWorkItem {
  id?: number
  milestone_id?: number | null
  milestoneId?: number | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function booleanValue(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return !['0', 'false', 'no', 'off'].includes(value.toLowerCase())
  return false
}

function normalizeDocument(raw: RuntimeDocument) {
  return {
    id: Number(raw.id),
    uuid: stringValue(raw.uuid),
    title: stringValue(raw.title),
    projectId: numberValue(raw.projectId ?? raw.project_id),
    projectCode: stringValue(raw.projectCode ?? raw.project_code) || null,
    milestoneId: numberValue(raw.milestoneId ?? raw.milestone_id),
    workItemId: numberValue(raw.workItemId ?? raw.work_item_id),
    parentId: numberValue(raw.parentId ?? raw.parent_id),
    docCategory: stringValue(raw.docCategory ?? raw.doc_category) || null,
    isFolder: booleanValue(raw.isFolder ?? raw.is_folder),
    codocsUuid: stringValue(raw.codocsUuid ?? raw.codocs_uuid) || null,
    documentSource: raw.documentSource ?? raw.document_source ?? 'codocs',
    repoProjectCode: stringValue(raw.repoProjectCode ?? raw.repo_project_code) || null,
    repoFilePath: stringValue(raw.repoFilePath ?? raw.repo_file_path) || null,
    repoCommitId: stringValue(raw.repoCommitId ?? raw.repo_commit_id) || null,
    ossPath: stringValue(raw.ossPath ?? raw.oss_path) || null,
    contentSize: Number(raw.contentSize ?? raw.content_size) || 0,
    createdBy: stringValue(raw.createdBy ?? raw.created_by),
    createdAt: stringValue(raw.createdAt ?? raw.created_at),
    updatedAt: stringValue(raw.updatedAt ?? raw.updated_at),
    sortOrder: Number(raw.sortOrder ?? raw.sort_order) || 0,
    accessLifecycleStage: raw.accessLifecycleStage ?? raw.access_lifecycle_stage ?? 'draft',
    accessConfidentialityLevel: raw.accessConfidentialityLevel ?? raw.access_confidentiality_level ?? 'L2',
    accessSummary: stringValue(raw.accessSummary ?? raw.access_summary) || '仅项目成员',
    virtual: Boolean(raw.virtual),
    virtualSource: raw.virtualSource
  }
}

function documentRefType(doc: ReturnType<typeof normalizeDocument>): DocumentRefType {
  return doc.documentSource === 'codocs' ? 'codocs_document' : 'cabinet_file'
}

function documentUuid(doc: ReturnType<typeof normalizeDocument>) {
  return documentRefType(doc) === 'codocs_document' ? (doc.codocsUuid || doc.uuid) : doc.uuid
}

function documentDedupKey(doc: ReturnType<typeof normalizeDocument>) {
  if (doc.documentSource === 'repo') {
    return `repo:${doc.repoProjectCode || ''}:${doc.repoFilePath || ''}`
  }
  return `codocs:${doc.codocsUuid || doc.uuid}`
}

function isDirectProjectDocument(
  doc: ReturnType<typeof normalizeDocument>,
  projectId: number,
  projectCode: string
) {
  return doc.projectId === projectId
    || Boolean(projectCode && doc.projectCode === projectCode)
}

function canRepairMissingSourcePolicy(reason: string) {
  return reason === 'draft_requires_project_member' || reason === 'no_matching_grant'
}

function directProjectMemberAccess(
  doc: ReturnType<typeof normalizeDocument>,
  projectContext: Awaited<ReturnType<typeof getProjectContext>>,
  projectId: number
) {
  if (
    !projectContext.isMember
    || !isDirectProjectDocument(doc, projectId, projectContext.projectCode)
  ) {
    return null
  }

  return {
    readonly: true,
    reason: 'project_member_direct',
    permission: 'view',
    lifecycleStage: doc.accessLifecycleStage,
    confidentialityLevel: doc.accessConfidentialityLevel
  }
}

function normalizeRuntimeItems<T>(data: RuntimePage<T> | T[] | null | undefined) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  return []
}

function applyWorkItemMilestone(raw: RuntimeDocument, workItemMilestones: Map<number, number>) {
  const workItemId = numberValue(raw.workItemId ?? raw.work_item_id)
  if (!workItemId || raw.milestoneId || raw.milestone_id) return raw

  const milestoneId = workItemMilestones.get(workItemId)
  if (!milestoneId) return raw
  return {
    ...raw,
    milestone_id: milestoneId
  }
}

function normalizeDeliverableDocument(
  raw: RuntimeDeliverable,
  projectId: number,
  projectCode: string,
  workItemMilestones: Map<number, number>
): RuntimeDocument | null {
  const id = numberValue(raw.id)
  if (!id) return null

  const documentSource = raw.documentSource ?? raw.document_source ?? 'codocs'
  const documentUuidValue = stringValue(raw.documentUuid ?? raw.document_uuid)
  const repoProjectCode = stringValue(raw.repoProjectCode ?? raw.repo_project_code)
  const repoFilePath = stringValue(raw.repoFilePath ?? raw.repo_file_path)
  const hasCodocsDocument = documentSource !== 'repo' && Boolean(documentUuidValue)
  const hasRepoDocument = documentSource === 'repo' && Boolean(repoProjectCode && repoFilePath)
  if (!hasCodocsDocument && !hasRepoDocument) return null

  const workItemId = numberValue(raw.matterId ?? raw.matter_id) || numberValue(raw.targetId ?? raw.target_id)
  const milestoneId = workItemId ? workItemMilestones.get(workItemId) || null : null
  const title = stringValue(raw.documentTitle ?? raw.document_title)
    || stringValue(raw.name)
    || '任务交付文档'
  const updatedAt = stringValue(raw.submittedAt ?? raw.submitted_at)
    || stringValue(raw.updatedAt ?? raw.updated_at)

  return {
    id: -id,
    uuid: documentSource === 'repo' ? `deliverable-repo-${id}` : (documentUuidValue || `deliverable-${id}`),
    title,
    project_id: projectId,
    project_code: projectCode,
    milestone_id: milestoneId,
    work_item_id: workItemId,
    parent_id: null,
    doc_category: 'delivery_doc',
    is_folder: false,
    codocs_uuid: documentSource === 'repo' ? null : documentUuidValue,
    document_source: documentSource,
    repo_project_code: repoProjectCode || null,
    repo_file_path: repoFilePath || null,
    repo_commit_id: stringValue(raw.repoCommitId ?? raw.repo_commit_id) || null,
    content_size: 0,
    created_by: stringValue(raw.submittedBy ?? raw.submitted_by),
    created_at: updatedAt,
    updated_at: updatedAt,
    sort_order: 0,
    access_lifecycle_stage: 'draft',
    access_confidentiality_level: 'L2',
    access_summary: '任务交付文档',
    virtual: true,
    virtualSource: 'deliverable'
  }
}

async function loadWorkItemMilestones(event: Parameters<typeof callAimsRuntime>[0], projectId: number, uid: string) {
  try {
    const workItemsPage = await callAimsRuntime<RuntimePage<RuntimeWorkItem> | RuntimeWorkItem[]>(
      event,
      `/v1/aims/projects/${encodeURIComponent(String(projectId))}/work-items`,
      {
        query: {
          current_user: uid,
          operator_uid: uid,
          pageSize: 1000
        },
        scope: 'aims.read'
      }
    )

    const map = new Map<number, number>()
    for (const item of normalizeRuntimeItems(workItemsPage)) {
      const id = numberValue(item.id)
      const milestoneId = numberValue(item.milestoneId ?? item.milestone_id)
      if (id && milestoneId) map.set(id, milestoneId)
    }
    return map
  } catch {
    return new Map<number, number>()
  }
}

async function loadUnifiedProjectDocuments(event: Parameters<typeof callAimsRuntime>[0], projectId: number, projectCode: string, uid: string) {
  const documentRequests = [
    callAimsRuntime<RuntimePage<RuntimeDocument> | RuntimeDocument[]>(
      event,
      '/v1/aims/documents',
      {
        query: {
          current_user: uid,
          operator_uid: uid,
          project_id: projectId,
          pageSize: 500
        },
        scope: 'aims.read'
      }
    )
  ]

  if (projectCode) {
    documentRequests.push(
      callAimsRuntime<RuntimePage<RuntimeDocument> | RuntimeDocument[]>(
        event,
        '/v1/aims/documents',
        {
          query: {
            current_user: uid,
            operator_uid: uid,
            project_code: projectCode,
            pageSize: 500
          },
          scope: 'aims.read'
        }
      )
    )
  }

  const [documentPages, workItemMilestones] = await Promise.all([
    Promise.all(documentRequests),
    loadWorkItemMilestones(event, projectId, uid)
  ])

  const docsById = new Map<number, ReturnType<typeof normalizeDocument>>()
  for (const page of documentPages) {
    for (const doc of normalizeRuntimeItems(page)
      .map(item => applyWorkItemMilestone(item, workItemMilestones))
      .map(normalizeDocument)
      .filter(item => Number.isFinite(item.id) && item.id > 0)) {
      docsById.set(doc.id, doc)
    }
  }

  const docs = [...docsById.values()]

  const dedupKeys = new Set(docs.filter(doc => !doc.isFolder).map(documentDedupKey))
  const deliverablesPage = await callAimsRuntime<RuntimePage<RuntimeDeliverable> | RuntimeDeliverable[]>(
    event,
    '/v1/aims/deliverables',
    {
      query: {
        current_user: uid,
        operator_uid: uid,
        project_id: projectId,
        deliverable_type: 'document',
        pageSize: 500
      },
      scope: 'aims.read'
    }
  )

  const deliverableDocs = normalizeRuntimeItems(deliverablesPage)
    .map(deliverable => normalizeDeliverableDocument(deliverable, projectId, projectCode, workItemMilestones))
    .filter((doc): doc is RuntimeDocument => Boolean(doc))
    .map(normalizeDocument)
    .filter((doc) => {
      const key = documentDedupKey(doc)
      if (dedupKeys.has(key)) return false
      dedupKeys.add(key)
      return true
    })

  return [...docs, ...deliverableDocs]
}

function includeAncestorFolders(
  allDocs: Array<ReturnType<typeof normalizeDocument>>,
  allowedDocumentIds: Set<number>
) {
  const byId = new Map(allDocs.map(doc => [doc.id, doc]))
  const includedIds = new Set(allowedDocumentIds)

  for (const docId of allowedDocumentIds) {
    let parentId = byId.get(docId)?.parentId || null
    const visited = new Set<number>()
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      includedIds.add(parent.id)
      parentId = parent.parentId || null
    }
  }

  return allDocs.filter(doc => includedIds.has(doc.id))
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const query = getQuery(event)
  const projectId = numberValue(query.projectId ?? query.project_id)
  if (!projectId) {
    throw createError({ statusCode: 400, message: '请选择项目' })
  }

  const projectContext = await getProjectContext(event, projectId, uid)
  const allDocs = await loadUnifiedProjectDocuments(event, projectId, projectContext.projectCode, uid)

  const allowedDocumentIds = new Set<number>()
  const accessById = new Map<number, {
    readonly: boolean
    reason: string
    permission: string
    lifecycleStage: string
    confidentialityLevel: string
  }>()

  await Promise.all(allDocs
    .filter(doc => !doc.isFolder)
    .map(async (doc) => {
      const uuid = documentUuid(doc)
      if (!uuid) return

      try {
        let access = await checkCodocsDocumentAccess({
          event,
          documentUuid: uuid,
          documentRefType: documentRefType(doc),
          sourceProjectCode: projectContext.projectCode,
          action: 'view',
          actorUid: uid,
          actorProjectCodes: projectContext.actorProjectCodes,
          actorDeptCodes: projectContext.actorDeptCodes,
          actorRoles: projectContext.actorRoles
        })

        if (
          !access.allowed
          && projectContext.isMember
          && projectContext.projectCode
          && isDirectProjectDocument(doc, projectId, projectContext.projectCode)
          && canRepairMissingSourcePolicy(access.reason)
        ) {
          const policy = await getCodocsDocumentAccessPolicy({
            event,
            documentUuid: uuid,
            documentRefType: documentRefType(doc),
            sourceProjectCode: projectContext.projectCode,
            operatorUid: uid
          })

          if (!policy.sourceProjectCode) {
            await updateCodocsDocumentAccessPolicy({
              event,
              documentUuid: uuid,
              documentRefType: documentRefType(doc),
              sourceProjectCode: projectContext.projectCode,
              lifecycleStage: policy.lifecycleStage,
              confidentialityLevel: policy.confidentialityLevel,
              defaultPermission: policy.defaultPermission,
              allowInternalAccess: policy.allowInternalAccess,
              allowCrossProject: policy.allowCrossProject,
              readonly: policy.readonly,
              grants: policy.grants.map(grant => ({
                subjectType: grant.subjectType,
                subjectCode: grant.subjectCode,
                permission: grant.permission,
                expiresAt: grant.expiresAt
              })),
              operatorUid: uid
            })

            access = await checkCodocsDocumentAccess({
              event,
              documentUuid: uuid,
              documentRefType: documentRefType(doc),
              sourceProjectCode: projectContext.projectCode,
              action: 'view',
              actorUid: uid,
              actorProjectCodes: projectContext.actorProjectCodes,
              actorDeptCodes: projectContext.actorDeptCodes,
              actorRoles: projectContext.actorRoles
            })
          }
        }

        if (!access.allowed) {
          const fallbackAccess = directProjectMemberAccess(doc, projectContext, projectId)
          if (!fallbackAccess) return

          allowedDocumentIds.add(doc.id)
          accessById.set(doc.id, fallbackAccess)
          return
        }
        allowedDocumentIds.add(doc.id)
        accessById.set(doc.id, {
          readonly: access.readonly,
          reason: access.reason,
          permission: access.permission,
          lifecycleStage: access.lifecycleStage,
          confidentialityLevel: access.confidentialityLevel
        })
      } catch {
        const fallbackAccess = directProjectMemberAccess(doc, projectContext, projectId)
        if (!fallbackAccess) return

        allowedDocumentIds.add(doc.id)
        accessById.set(doc.id, fallbackAccess)
      }
    }))

  const visibleDocs = includeAncestorFolders(allDocs, allowedDocumentIds)
    .map((doc) => {
      const access = accessById.get(doc.id)
      return {
        ...doc,
        accessAllowed: doc.isFolder ? true : Boolean(access),
        accessReadonly: access?.readonly ?? false,
        accessReason: access?.reason ?? null,
        accessPermission: access?.permission ?? null,
        accessLifecycleStage: access?.lifecycleStage ?? doc.accessLifecycleStage,
        accessConfidentialityLevel: access?.confidentialityLevel ?? doc.accessConfidentialityLevel
      }
    })

  return {
    code: 0,
    data: {
      items: visibleDocs,
      total: visibleDocs.filter(doc => !doc.isFolder).length
    }
  }
})
