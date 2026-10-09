/**
 * 登记文档/文件夹
 * POST /api/v1/documents
 *
 * 逻辑在 server/utils/projectDocumentWrites.ts，企业宿主的 service 端点复用同一份。
 */
import { createProjectDocumentIndexEntry, type CreateDocumentIndexBody } from '~~/server/utils/projectDocumentWrites'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }
  return await createProjectDocumentIndexEntry(event, uid, await readBody<CreateDocumentIndexBody>(event))
})
