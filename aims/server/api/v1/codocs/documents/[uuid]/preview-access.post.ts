/**
 * Prepare Codocs iframe preview access for an AIMS project document.
 * POST /api/v1/codocs/documents/:uuid/preview-access
 */
import { ensureCodocsDocumentPreviewAccess } from '~~/server/utils/codocsApi'
import { callAimsRuntime } from '~~/server/utils/projectDocumentAccess'

interface RuntimePage<T> {
  items?: T[]
}

interface RuntimeDocument {
  codocs_uuid?: string | null
  codocsUuid?: string | null
  title?: string | null
}

interface RuntimeProject {
  project_code?: string | null
  projectCode?: string | null
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

interface RuntimeDeliverable {
  document_uuid?: string | null
  documentUuid?: string | null
  document_title?: string | null
  documentTitle?: string | null
  name?: string | null
}

function normalizeItems<T>(data: RuntimePage<T> | T[] | null | undefined) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  return []
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function projectField(project: RuntimeProject, camel: keyof RuntimeProject, snake: keyof RuntimeProject) {
  return stringValue(project[camel] ?? project[snake])
}

async function assertProjectDocumentPreviewAccess(event: Parameters<typeof callAimsRuntime>[0], projectId: number, uuid: string, uid: string) {
  const [project, membersPage] = await Promise.all([
    callAimsRuntime<RuntimeProject>(
      event,
      `/v1/aims/projects/${encodeURIComponent(String(projectId))}`,
      {
        query: { current_user: uid, operator_uid: uid },
        scope: 'aims.read'
      }
    ),
    callAimsRuntime<RuntimePage<RuntimeProjectMember>>(
      event,
      `/v1/aims/projects/${encodeURIComponent(String(projectId))}/members`,
      {
        query: { current_user: uid, operator_uid: uid, pageSize: 100 },
        scope: 'aims.read'
      }
    )
  ])

  const members = normalizeItems(membersPage)
  const member = members.find(item => stringValue(item.uid) === uid && (!item.status || item.status === 'active'))
  const leaderUid = projectField(project, 'leaderUid', 'leader_uid')
  const createdBy = projectField(project, 'createdBy', 'created_by')
  if (!member && leaderUid !== uid && createdBy !== uid) {
    throw createError({ statusCode: 403, message: '仅项目成员可查看项目文档' })
  }

  const projectCode = projectField(project, 'projectCode', 'project_code')
  if (!projectCode) {
    throw createError({ statusCode: 400, message: '项目缺少项目编码，无法准备文档预览权限' })
  }

  const documentRequests = [
    callAimsRuntime<RuntimePage<RuntimeDocument> | RuntimeDocument[]>(
      event,
      '/v1/aims/documents',
      {
        query: {
          current_user: uid,
          operator_uid: uid,
          project_id: projectId,
          codocs_uuid: uuid,
          pageSize: 1
        },
        scope: 'aims.read'
      }
    ),
    callAimsRuntime<RuntimePage<RuntimeDocument> | RuntimeDocument[]>(
      event,
      '/v1/aims/documents',
      {
        query: {
          current_user: uid,
          operator_uid: uid,
          project_code: projectCode,
          codocs_uuid: uuid,
          pageSize: 1
        },
        scope: 'aims.read'
      }
    )
  ]

  const [documentPages, deliverablesPage] = await Promise.all([
    Promise.all(documentRequests),
    callAimsRuntime<RuntimePage<RuntimeDeliverable> | RuntimeDeliverable[]>(
      event,
      '/v1/aims/deliverables',
      {
        query: {
          current_user: uid,
          operator_uid: uid,
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

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const uuid = String(getRouterParam(event, 'uuid') || '').trim()
  if (!uuid) {
    throw createError({ statusCode: 400, message: '文档 UUID 不能为空' })
  }

  const body = await readBody<{ projectId?: number | string, project_id?: number | string }>(event)
  const projectId = Number(body.projectId ?? body.project_id) || 0
  if (!projectId) {
    throw createError({ statusCode: 400, message: '缺少项目 ID' })
  }

  const context = await assertProjectDocumentPreviewAccess(event, projectId, uuid, uid)
  const access = await ensureCodocsDocumentPreviewAccess({
    event,
    documentUuid: uuid,
    actorUid: uid,
    sourceProjectCode: context.projectCode
  })

  return {
    code: 0,
    data: {
      uuid,
      title: context.title,
      access
    }
  }
})
