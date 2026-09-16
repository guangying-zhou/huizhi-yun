import { getCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { downloadDocument } from '~~/server/utils/oss'
import { hasMeaningfulMarkdownContent, recoverMarkdownFromYjsSnapshot } from '~~/server/utils/yjsMarkdownRecovery'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'documents', 'export', '缺少文档导出权限')

  const uuid = getRouterParam(event, 'uuid')
  if (!uuid) {
    throw createError({ statusCode: 400, message: 'Document UUID is required' })
  }

  const doc = await getCodocsDocumentMetadata(event, uuid, { actorUid: getRequestUid(event) })
  if (!doc.oss_path) {
    throw createError({ statusCode: 404, message: 'Document content not found in OSS' })
  }

  let filename = doc.title
  if (!filename.toLowerCase().endsWith('.md')) {
    filename += '.md'
  }

  try {
    console.log(`Downloading document: ${uuid} - ${filename} from ${doc.oss_path}`)

    let content = await downloadDocument(doc.oss_path, doc.doc_type)
    if (!hasMeaningfulMarkdownContent(content)) {
      content = await recoverMarkdownFromYjsSnapshot(doc.oss_path, doc.doc_type)
    }

    setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
    const encodedFilename = encodeURIComponent(filename)
    setResponseHeader(event, 'Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`)

    return Buffer.from(content || '', 'utf-8')
  } catch (error: unknown) {
    const err = error as { code?: string, message?: string }
    console.error('Download failed:', error)
    if (err.code === 'NoSuchKey') {
      throw createError({ statusCode: 404, message: 'File not found in storage' })
    }
    throw createError({ statusCode: 500, message: 'Failed to download file' })
  }
})
