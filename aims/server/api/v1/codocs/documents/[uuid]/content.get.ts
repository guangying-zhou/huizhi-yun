/**
 * 获取 Codocs 文档完整内容（Markdown 原文）
 * GET /api/v1/codocs/documents/:uuid/content
 *
 * 桥接 Codocs 的内部文档接口，通过 auth_user cookie 代理当前用户身份
 * 供需求分解页解析大纲使用
 */
import { getCodocsProjectDocumentContent } from '~~/server/utils/codocsApi'
import { assertCodocsProjectDocumentAccess } from '~~/server/utils/projectDocumentAccess'

function stringValue(value: unknown) {
  return String(value || '').trim()
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
    if (!projectId) {
      throw createError({ statusCode: 400, message: '缺少项目 ID，无法校验项目文档访问权限' })
    }

    let accessContext: { title?: string, projectCode?: string } | null = null
    try {
      accessContext = await assertCodocsProjectDocumentAccess(event, projectId, uuid, uid)
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

    let res
    try {
      res = await getCodocsProjectDocumentContent({
        event,
        actorUid: uid,
        projectCode: accessContext?.projectCode || '',
        documentUuid: uuid
      })
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
