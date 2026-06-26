/**
 * 协同文档中心
 * GET /api/collab-docs
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  const query = getQuery(event)
  const data = await callCodocsTenantRuntime(event, '/v1/codocs/collab-docs', {
    query: {
      ...query,
      current_user: uid
    },
    scope: 'codocs.read'
  })

  return {
    code: 0,
    data
  }
})
