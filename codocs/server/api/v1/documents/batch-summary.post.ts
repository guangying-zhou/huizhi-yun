/**
 * 批量获取文档摘要
 * POST /api/v1/documents/batch-summary
 * Body: { uuids: string[] }
 *
 * 供其他模块调用，需 Console service token
 * 单次最多 50 个 UUID
 */
import { verifyInternalApi } from '~~/server/utils/internalApi'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface DocumentRow {
  uuid: string
  title?: string | null
  doc_type?: string
  owner_uid?: string
  status?: number
  content_size?: number
  ai_abstract?: string | null
  updated_at?: string
  error?: string
}

export default defineEventHandler(async (event) => {
  await verifyInternalApi(event, { scopes: ['codocs:documents:read'] })

  const body = await readBody<{ uuids?: string[] }>(event)
  if (!body.uuids || !Array.isArray(body.uuids) || body.uuids.length === 0) {
    throw createError({ statusCode: 400, message: 'uuids 不能为空' })
  }

  if (body.uuids.length > 50) {
    throw createError({ statusCode: 400, message: '单次最多查询 50 个文档' })
  }

  const rows = await callCodocsTenantRuntime<DocumentRow[]>(event, '/v1/codocs/documents/batch-summary', {
    method: 'POST',
    scope: 'codocs.read',
    body: {
      uuids: body.uuids
    }
  })

  const result = rows.map((doc) => {
    if (doc.error) return { uuid: doc.uuid, title: null, error: doc.error }
    return {
      uuid: doc.uuid,
      title: doc.title,
      docType: doc.doc_type,
      ownerUid: doc.owner_uid,
      status: doc.status,
      contentSize: doc.content_size,
      aiAbstract: doc.ai_abstract,
      updatedAt: doc.updated_at
    }
  })

  return {
    code: 0,
    data: result
  }
})
