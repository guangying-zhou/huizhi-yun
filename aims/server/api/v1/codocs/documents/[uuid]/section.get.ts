/**
 * 按锚点截取 Codocs 文档的章节原文
 * GET /api/v1/codocs/documents/:uuid/section?anchor=<urlencoded>
 *
 * 供工作项详情页的"源章节懒加载"组件使用，支持断链降级
 */
import { getCodocsDocumentContent } from '~~/server/utils/codocsApi'
import { extractSection } from '~~/server/utils/markdownOutline'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const uuid = String(getRouterParam(event, 'uuid') || '').trim()
  const query = getQuery(event)
  const anchor = typeof query.anchor === 'string' ? query.anchor.trim() : ''

  if (!uuid) {
    throw createError({ statusCode: 400, message: '文档 UUID 不能为空' })
  }
  if (!anchor) {
    throw createError({ statusCode: 400, message: '锚点参数不能为空' })
  }

  let doc: Awaited<ReturnType<typeof getCodocsDocumentContent>>
  try {
    doc = await getCodocsDocumentContent(uuid, uid, event)
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number })?.statusCode
    if (statusCode === 404) {
      return {
        code: 0,
        data: {
          missing: true,
          reason: 'document_not_found',
          documentUuid: uuid,
          anchor
        }
      }
    }
    throw error
  }

  if (!doc?.data) {
    return {
      code: 0,
      data: {
        missing: true,
        reason: 'document_not_found',
        documentUuid: uuid,
        anchor
      }
    }
  }

  const section = extractSection(doc.data.content || '', anchor)
  if (!section) {
    return {
      code: 0,
      data: {
        missing: true,
        reason: 'anchor_not_found',
        documentUuid: uuid,
        documentTitle: doc.data.title,
        anchor,
        updatedAt: doc.data.updated_at
      }
    }
  }

  return {
    code: 0,
    data: {
      missing: false,
      documentUuid: uuid,
      documentTitle: doc.data.title,
      anchor,
      title: section.title,
      depth: section.depth,
      markdown: section.markdown,
      updatedAt: doc.data.updated_at
    }
  }
})
