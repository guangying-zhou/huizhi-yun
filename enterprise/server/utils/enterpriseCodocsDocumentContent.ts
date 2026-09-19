import { createError, type H3Event } from 'h3'
import { downloadDocument } from '../../../codocs/server/utils/oss'
import { hasMeaningfulMarkdownContent, recoverMarkdownFromYjsSnapshot } from '../../../codocs/server/utils/yjsMarkdownRecovery'

// Called only with metadata obtained from the actor-bound Runtime read. Never
// accept an OSS key or document type directly from the browser.
export async function withEnterpriseCodocsDocumentContent(event: H3Event, response: unknown, uuid: string, skipContent: boolean, permission: 'view' | 'export' = 'view') {
  const envelope = response as { success?: boolean, data?: Record<string, unknown> }
  const doc = envelope?.data
  if (envelope?.success !== true || !doc || doc.uuid !== uuid) throw createError({ statusCode: 503, message: '文档元数据响应无效' })
  const path = typeof doc.oss_path === 'string' ? doc.oss_path : ''
  const type = typeof doc.doc_type === 'string' ? doc.doc_type : ''
  let content = ''
  if (!skipContent && path) {
    try {
      const source = await downloadDocument(path, type, { event })
      content = source || ''
      if (!hasMeaningfulMarkdownContent(content)) content = await recoverMarkdownFromYjsSnapshot(path, type, { event })
      if (source === null && !hasMeaningfulMarkdownContent(content)) throw createError({ statusCode: 404, message: '文档正文不存在' })
    } catch (error) {
      if ((error as { statusCode?: number })?.statusCode === 404) throw error
      throw createError({ statusCode: 503, message: '文档存储暂不可用' })
    }
    if (path.startsWith('codocs/company/')) {
      try {
        const { recordEnterpriseCodocsDocumentAccess } = await import('./enterpriseCodocsDocumentAccessRecord')
        await recordEnterpriseCodocsDocumentAccess(event, uuid, path, permission)
      } catch (error) {
        // Never release the loaded bytes if auditing or its fresh ACL check fails.
        const status = (error as { statusCode?: number })?.statusCode
        if (status === 401 || status === 403 || status === 409) {
          throw createError({ statusCode: status, message: status === 409 ? '文档存储已变更，请重新读取' : '文档访问授权已失效' })
        }
        throw createError({ statusCode: 503, message: '文档访问记录暂不可用' })
      }
    }
  }
  return { success: true, data: { ...doc, readonly_flag: doc.readonly ? 1 : doc.readonly_flag, content } }
}
