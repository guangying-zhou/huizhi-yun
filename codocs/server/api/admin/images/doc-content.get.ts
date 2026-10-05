/**
 * 获取图片所属文档的文本内容
 * GET /api/admin/images/doc-content?docPath=...
 */
import { findImageOwnerDocument, readImageOwnerDocumentContent } from '~~/server/utils/adminImageDocuments'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin', 'admin', '仅管理员可查看图片清理文档内容')

  const query = getQuery(event)
  const docPath = String(query.docPath || '').trim()
  if (!docPath) {
    throw createError({ statusCode: 400, message: '缺少 docPath 参数' })
  }

  const doc = await findImageOwnerDocument(event, docPath)
  if (!doc) {
    throw createError({ statusCode: 404, message: '关联文档不存在' })
  }

  const content = await readImageOwnerDocumentContent(event, doc)
  return {
    success: true,
    data: {
      uuid: doc.uuid,
      title: doc.title,
      docType: doc.doc_type,
      ossPath: doc.oss_path,
      content: content || ''
    }
  }
})
