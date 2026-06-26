/**
 * 获取图片所属文档的文本内容
 * GET /api/admin/images/doc-content?docPath=...
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { downloadDocument } from '~~/server/utils/oss'

interface RuntimePage<T> {
  items?: T[]
}

interface DocumentRow {
  uuid: string
  title: string
  doc_type: string
  oss_path: string
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const docPath = String(query.docPath || '').trim()
  if (!docPath) {
    throw createError({ statusCode: 400, message: '缺少 docPath 参数' })
  }

  const page = await callCodocsTenantRuntime<RuntimePage<DocumentRow>>(event, '/v1/codocs/documents', {
    query: {
      oss_path: docPath,
      limit: 1
    },
    scope: 'codocs.read'
  })
  const doc = page.items?.[0]
  if (!doc) {
    throw createError({ statusCode: 404, message: '关联文档不存在' })
  }

  const content = await downloadDocument(doc.oss_path, doc.doc_type)
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
