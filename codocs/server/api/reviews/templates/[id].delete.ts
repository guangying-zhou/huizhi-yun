/**
 * 删除审批流程模板
 * DELETE /api/reviews/templates/:id
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  requireRequestUid(event, '未登录')
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '缺少模板ID' })
  }

  await callCodocsTenantRuntime(event, `/v1/codocs/reviews/templates/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    scope: 'codocs.write'
  })

  return { code: 0, message: 'success' }
})
