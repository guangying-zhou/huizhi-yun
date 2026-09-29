/**
 * GET /api/v1/project-documents/accessible
 *
 * 逻辑在 server/utils/accessibleProjectDocuments.ts，企业宿主的 service 端点复用同一份。
 */
import { listAccessibleProjectDocuments } from '~~/server/utils/accessibleProjectDocuments'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }
  const query = getQuery(event)
  return await listAccessibleProjectDocuments(event, uid, query.projectId ?? query.project_id)
})
