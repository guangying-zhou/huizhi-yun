/**
 * 查询文档发布申请详情
 * GET /api/reviews/publish-requests/:id
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '缺少发布申请ID' })
  }

  const data = await callCodocsTenantRuntime(event, `/v1/codocs/reviews/publish-requests/${encodeURIComponent(id)}`, {
    scope: 'codocs.read'
  })

  return {
    code: 0,
    message: 'success',
    data
  }
})
