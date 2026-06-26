/**
 * 代理获取 Codocs 文档内容（用于预览）
 * GET /api/v1/documents/preview?uuid=xxx
 */
import { getCodocsDocumentContent } from '~~/server/utils/codocsApi'

interface DocumentPreviewResponse {
  code: number
  message: string
  data: {
    title: string
    content: string
    doc_type: string
    owner_uid: string
    updated_at: string
  }
}

function getStatusCode(error: unknown) {
  const statusCode = (error as { statusCode?: unknown })?.statusCode
  return typeof statusCode === 'number' ? statusCode : 500
}

export default defineEventHandler(async (event): Promise<DocumentPreviewResponse> => {
  requireAuth(event)
  const query = getQuery(event)
  const uuid = String(query.uuid || '')
  if (!uuid) {
    throw createError({ statusCode: 400, statusMessage: '请提供文档UUID' })
  }

  try {
    const document = await getCodocsDocumentContent(uuid)

    return {
      code: 0,
      message: 'ok',
      data: {
        title: document.title,
        content: document.content || '',
        doc_type: document.docType,
        owner_uid: document.ownerUid,
        updated_at: document.updatedAt
      }
    }
  } catch (error: unknown) {
    throw createError({ statusCode: getStatusCode(error), statusMessage: '获取文档内容失败' })
  }
})
