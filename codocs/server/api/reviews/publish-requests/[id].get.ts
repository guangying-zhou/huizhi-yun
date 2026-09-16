/**
 * 查询文档发布申请详情
 * GET /api/reviews/publish-requests/:id
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { withTrustedCodocsReviewReadContext } from '~~/server/utils/reviewReadScope'

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  await requirePermission(event, 'reviews', 'view', '缺少审阅查看权限')
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '缺少发布申请ID' })
  }

  const data = await callCodocsTenantRuntime(event, `/v1/codocs/reviews/publish-requests/${encodeURIComponent(id)}`, {
    query: withTrustedCodocsReviewReadContext({}, uid),
    scope: 'codocs.read'
  })

  return {
    code: 0,
    message: 'success',
    data
  }
})
