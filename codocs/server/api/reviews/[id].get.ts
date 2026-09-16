/**
 * 获取审阅详情
 * GET /api/reviews/:id
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  await requirePermission(event, 'reviews', 'view', '缺少审阅查看权限')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '缺少审阅ID' })
  }

  const data = await callCodocsTenantRuntime(event, `/v1/codocs/reviews/${encodeURIComponent(id)}`, {
    query: {
      current_user: uid
    },
    scope: 'codocs.read'
  })

  return {
    code: 0,
    message: 'success',
    data
  }
})
