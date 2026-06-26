/**
 * 获取我的审阅列表
 * GET /api/reviews/my
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  const query = getQuery(event)
  const data = await callCodocsTenantRuntime<unknown[]>(event, '/v1/codocs/reviews/my', {
    query: {
      ...query,
      current_user: uid,
      limit: query.limit || 500
    },
    scope: 'codocs.read'
  })

  return {
    code: 0,
    message: 'success',
    data: Array.isArray(data) ? data : []
  }
})
