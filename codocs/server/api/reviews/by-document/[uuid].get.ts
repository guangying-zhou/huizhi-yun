/**
 * 根据文档UUID查询审阅记录
 * GET /api/reviews/by-document/:uuid
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { withTrustedCodocsReviewReadContext } from '~~/server/utils/reviewReadScope'

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  await requirePermission(event, 'reviews', 'view', '缺少审阅查看权限')
  const uuid = getRouterParam(event, 'uuid')
  if (!uuid) {
    throw createError({ statusCode: 400, message: '缺少文档UUID' })
  }

  const data = await callCodocsTenantRuntime(event, `/v1/codocs/reviews/by-document/${encodeURIComponent(uuid)}`, {
    query: withTrustedCodocsReviewReadContext({}, uid),
    scope: 'codocs.read'
  })

  return {
    code: 0,
    message: 'success',
    data
  }
})
