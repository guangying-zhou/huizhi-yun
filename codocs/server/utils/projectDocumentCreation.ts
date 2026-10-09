import { createError, type H3Event } from 'h3'
/**
 * 创建文档（模块间 API）
 * POST /api/v1/documents
 *
 * 供其他模块调用，需 Console service token
 */
import { createCodocsDocumentMetadata } from './codocsRuntime'
import { createRuntimeOSSClient, createRuntimeProjectsOSSClient } from './oss'
import { hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'

export async function createProjectDocumentContent(event: H3Event, body: Record<string, unknown>) {
  if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
    throw createError({ statusCode: 400, message: '文档标题不能为空' })
  }
  if (!body.ownerUid) {
    throw createError({ statusCode: 400, message: 'ownerUid 不能为空' })
  }

  const content = typeof body.content === 'string' ? body.content : ''
  const uuid = String(body.uuid || crypto.randomUUID())
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) throw createError({ statusCode: 400, message: '文档标识无效' })
  const creationHash = await hashServiceCommandPayload({ ...body, uuid, content })
  const ossPath = `codocs/document-creations/${uuid}/${creationHash}.md`
  const client = body.docType === 'project'
    ? await createRuntimeProjectsOSSClient({ event })
    : await createRuntimeOSSClient({ event })

  const doc = await createCodocsDocumentMetadata(event, {
    title: String(body.title).trim(),
    docType: String(body.docType || 'private'),
    ownerUid: String(body.ownerUid),
    operatorUid: String(body.ownerUid),
    deptCode: body.deptCode ? String(body.deptCode) : null,
    projectCode: body.projectCode ? String(body.projectCode) : null,
    folderId: body.folderId ? Number(body.folderId) : null,
    folderPath: body.folderPath ? String(body.folderPath) : null,
    uuid,
    ossPath,
    contentSize: Buffer.byteLength(content, 'utf-8')
  })

  if (doc.oss_path) {
    // A repeated create may repair a failed initial upload, but must never
    // overwrite subsequent edits of an already published object.
    let exists = false
    try {
      await client.head(doc.oss_path)
      exists = true
    } catch (error) {
      const failure = error as { status?: number, statusCode?: number, code?: string }
      if (failure.status !== 404 && failure.statusCode !== 404 && failure.code !== 'NoSuchKey') throw error
    }
    if (!exists) await client.put(doc.oss_path, Buffer.from(content, 'utf-8'), { forbidOverwrite: true, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
  }

  return {
    code: 0,
    data: {
      uuid: doc.uuid,
      title: body.title.trim()
    }
  }
}
