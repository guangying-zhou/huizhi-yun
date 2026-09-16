/**
 * 获取文档摘要信息（不含正文）
 * GET /api/v1/documents/:uuid/summary
 *
 * 供其他模块调用，需 Console service token
 */
import { verifyInternalApi } from '~~/server/utils/internalApi'
import { fetchDirectoryUser } from '~~/server/utils/directoryCompat'
import { getCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'

const DIRECTORY_LOOKUP_TIMEOUT_MS = 1200

export default defineEventHandler(async (event) => {
  await verifyInternalApi(event, { scopes: ['codocs:documents:read'] })

  const uuid = getRouterParam(event, 'uuid')
  if (!uuid) {
    throw createError({ statusCode: 400, message: '缺少文档 UUID' })
  }

  const doc = await getCodocsDocumentMetadata(event, uuid)

  // 查询用户名（不阻塞，失败时返回 uid）
  const [owner, lastEditor] = await Promise.all([
    doc.owner_uid ? fetchDirectoryUser(doc.owner_uid, { timeout: DIRECTORY_LOOKUP_TIMEOUT_MS }).catch(() => null) : null,
    doc.last_editor_uid ? fetchDirectoryUser(doc.last_editor_uid, { timeout: DIRECTORY_LOOKUP_TIMEOUT_MS }).catch(() => null) : null
  ])

  return {
    code: 0,
    data: {
      uuid: doc.uuid,
      title: doc.title,
      docType: doc.doc_type,
      ownerUid: doc.owner_uid,
      ownerName: owner?.realName || doc.owner_uid,
      deptCode: doc.dept_code,
      projectCode: doc.project_code,
      status: doc.status,
      contentSize: doc.content_size,
      aiAbstract: doc.ai_abstract,
      readonlyFlag: doc.readonly_flag,
      lastEditorUid: doc.last_editor_uid,
      lastEditorName: lastEditor?.realName || doc.last_editor_uid,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at
    }
  }
})
