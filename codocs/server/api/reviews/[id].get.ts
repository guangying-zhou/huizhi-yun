/**
 * 获取审阅详情
 * GET /api/reviews/:id
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '缺少审阅ID' })
  }

  const data = await callCodocsTenantRuntime(event, `/v1/codocs/reviews/${encodeURIComponent(id)}`, {
    scope: 'codocs.read'
  })

  return {
    code: 0,
    message: 'success',
    data
  }
})
