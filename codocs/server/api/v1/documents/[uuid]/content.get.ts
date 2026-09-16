/**
 * 获取文档完整内容（Markdown 原文）
 * GET /api/v1/documents/:uuid/content
 *
 * 供其他模块调用（如 Aims 需求分解），需 Console service token
 * 不做用户级权限校验——调用方需自行保证权限
 */
import { verifyInternalApi } from '~~/server/utils/internalApi'
import { downloadDocument } from '~~/server/utils/oss'
import { hasMeaningfulMarkdownContent, recoverMarkdownFromYjsSnapshot } from '~~/server/utils/yjsMarkdownRecovery'
import { getCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  await verifyInternalApi(event, { scopes: ['codocs:documents:read'] })

  const uuid = getRouterParam(event, 'uuid')
  if (!uuid) {
    throw createError({ statusCode: 400, message: '缺少文档 UUID' })
  }

  const doc = await getCodocsDocumentMetadata(event, uuid)

  let content = ''
  if (doc.oss_path) {
    try {
      content = (await downloadDocument(doc.oss_path, doc.doc_type)) || ''
      if (!hasMeaningfulMarkdownContent(content)) {
        content = await recoverMarkdownFromYjsSnapshot(doc.oss_path, doc.doc_type)
      }
    } catch (error: unknown) {
      console.error('[v1/content] failed to read OSS:', doc.oss_path, (error as Error).message)
      throw createError({ statusCode: 500, message: '读取文档内容失败' })
    }
  }

  return {
    code: 0,
    data: {
      uuid: doc.uuid,
      title: doc.title,
      docType: doc.doc_type,
      ownerUid: doc.owner_uid,
      deptCode: doc.dept_code,
      projectCode: doc.project_code,
      contentSize: doc.content_size,
      content,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at
    }
  }
})
