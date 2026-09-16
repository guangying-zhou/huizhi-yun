/**
 * 查询当前主体可读取的文档发布申请。
 * GET /api/reviews/publish-requests
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { withTrustedCodocsReviewReadContext } from '~~/server/utils/reviewReadScope'

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  await requirePermission(event, 'reviews', 'view', '缺少审阅查看权限')

  const source = getQuery(event) as Record<string, unknown>
  const query = withTrustedCodocsReviewReadContext(source, uid)
  const data = await callCodocsTenantRuntime(event, '/v1/codocs/reviews/publish-requests', {
    query,
    scope: 'codocs.read'
  })

  return {
    code: 0,
    message: 'success',
    data
  }
})
