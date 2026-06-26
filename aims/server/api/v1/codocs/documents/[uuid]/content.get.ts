/**
 * 获取 Codocs 文档完整内容（Markdown 原文）
 * GET /api/v1/codocs/documents/:uuid/content
 *
 * 桥接 Codocs 的内部文档接口，通过 auth_user cookie 代理当前用户身份
 * 供需求分解页解析大纲使用
 */
import { getCodocsDocumentContent } from '~~/server/utils/codocsApi'
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

async function assertProjectDocumentAccess(event: Parameters<typeof callAimsRuntime>[0], projectId: number, uuid: string, uid: string) {
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
            current_user: uid,
            operator_uid: uid,
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
        title: stringValue(doc.title)
      }
    }
  }

  const deliverable = normalizeItems(deliverablesPage)
    .find(item => stringValue(item.documentUuid ?? item.document_uuid) === uuid)
  if (deliverable) {
    return {
      title: stringValue(deliverable.documentTitle ?? deliverable.document_title)
        || stringValue(deliverable.name)
    }
  }

  throw createError({ statusCode: 403, message: '该文档未关联到当前项目' })
}

function previewFallback(uuid: string, title: string, message: string) {
  return {
    code: 0,
    data: {
      uuid,
      title: title || '文档',
      docType: '',
      ownerUid: '',
      content: '',
      updatedAt: '',
      contentUnavailable: true,
      message
    }
  }
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

  try {
    const query = getQuery(event)
    const projectId = Number(query.projectId ?? query.project_id) || 0
    const previewMode = query.preview === '1' || query.preview === 'true'
    const fallbackTitle = stringValue(query.title)
    let accessContext: { title?: string } | null = null
    if (projectId) {
      try {
        accessContext = await assertProjectDocumentAccess(event, projectId, uuid, uid)
      } catch (accessError) {
        if (previewMode) {
          return previewFallback(
            uuid,
            fallbackTitle,
            (accessError as { message?: string })?.message || '暂时无法校验项目文档访问权限'
          )
        }
        throw accessError
      }
    }

    let res
    try {
      res = await getCodocsDocumentContent(uuid, uid, event)
    } catch (contentError) {
      if (!previewMode) throw contentError

      return previewFallback(
        uuid,
        fallbackTitle || accessContext?.title || '文档',
        (contentError as { message?: string })?.message || 'Codocs 文档内容暂时不可用'
      )
    }
    if (!res?.data) {
      throw createError({ statusCode: 404, message: '文档不存在或无法访问' })
    }

    return {
      code: 0,
      data: {
        uuid: res.data.uuid,
        title: res.data.title,
        docType: res.data.doc_type,
        ownerUid: res.data.owner_uid,
        content: res.data.content || '',
        updatedAt: res.data.updated_at
      }
    }
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number })?.statusCode || 502
    const message = (error as { message?: string })?.message || '获取文档内容失败'
    console.error('[decompose] Failed to fetch Codocs content:', message)
    throw createError({ statusCode, message })
  }
})
