/**
 * 删除文档/文件夹
 * DELETE /api/v1/documents/:id
 * 如果是文件夹，由 data-runtime/数据库外键级联删除子文档
 *
 * 逻辑在 server/utils/projectDocumentWrites.ts，企业宿主的 service 端点复用同一份。
 */
import { deleteProjectDocumentEntry } from '~~/server/utils/projectDocumentWrites'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '缺少文档 ID' })
  }
  return await deleteProjectDocumentEntry(event, uid, Number(id))
})
