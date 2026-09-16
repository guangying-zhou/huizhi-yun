/**
 * 创建文档（模块间 API）
 * POST /api/v1/documents
 *
 * 供其他模块调用，需 Console service token
 */
import { verifyInternalApi } from '~~/server/utils/internalApi'
import { createCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'
import { uploadDocument } from '~~/server/utils/oss'

export default defineEventHandler(async (event) => {
  await verifyInternalApi(event, { scopes: ['codocs:documents:write'] })

  const body = await readBody(event)

  if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
    throw createError({ statusCode: 400, message: '文档标题不能为空' })
  }
  if (!body.ownerUid) {
    throw createError({ statusCode: 400, message: 'ownerUid 不能为空' })
  }

  const content = typeof body.content === 'string' ? body.content : ''

  const doc = await createCodocsDocumentMetadata(event, {
    title: body.title.trim(),
    docType: body.docType || 'private',
    ownerUid: body.ownerUid,
    operatorUid: body.ownerUid,
    deptCode: body.deptCode || null,
    projectCode: body.projectCode || null,
    folderId: body.folderId || null,
    folderPath: body.folderPath || null,
    uuid: body.uuid || null,
    contentSize: Buffer.byteLength(content, 'utf-8')
  })

  if (doc.oss_path) {
    await uploadDocument(doc.oss_path, content, doc.doc_type)
  }

  return {
    code: 0,
    data: {
      uuid: doc.uuid,
      title: body.title.trim()
    }
  }
})
