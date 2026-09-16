/**
 * 协同文档中心
 * GET /api/collab-docs
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { checkPermission } from '~~/server/utils/checkPermission'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  const query = { ...getQuery(event) }
  delete query.current_user
  delete query.currentUser
  delete query.codocs_trusted_review_execution_admin
  const canAdminReviewExecution = await checkPermission(event, 'reviews', 'admin')
  const data = await callCodocsTenantRuntime(event, '/v1/codocs/collab-docs', {
    query: {
      ...query,
      current_user: uid,
      codocs_trusted_review_execution_admin: canAdminReviewExecution ? '1' : undefined
    },
    scope: 'codocs.read'
  })

  return {
    code: 0,
    data
  }
})
