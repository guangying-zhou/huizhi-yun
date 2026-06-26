/**
 * 根据文档UUID查询审阅记录
 * GET /api/reviews/by-document/:uuid
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  const uuid = getRouterParam(event, 'uuid')
  if (!uuid) {
    throw createError({ statusCode: 400, message: '缺少文档UUID' })
  }

  const data = await callCodocsTenantRuntime(event, `/v1/codocs/reviews/by-document/${encodeURIComponent(uuid)}`, {
    scope: 'codocs.read'
  })

  return {
    code: 0,
    message: 'success',
    data
  }
})
