/** 逻辑在 server/utils/projectDocumentAccessPolicy.ts，企业宿主的 service 端点复用同一份。 */
import { checkProjectDocumentAccess, normalizeDocumentAccessAction } from '~~/server/utils/projectDocumentAccessPolicy'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }
  const body = await readBody<{ action?: unknown }>(event)
  return await checkProjectDocumentAccess(
    event,
    uid,
    Number(getRouterParam(event, 'id')),
    Number(getRouterParam(event, 'documentId')),
    normalizeDocumentAccessAction(body?.action)
  )
})
