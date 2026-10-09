/**
 * 获取待处理 Issue 数量
 * GET /api/issues/pending-count
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { issueProjectCode, issueRuntimeQuery, resolveIssueProjectAccess } from '~~/server/utils/issueProjectAccess'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const access = await resolveIssueProjectAccess(event, issueProjectCode(query.project_code || query.projectCode), 'view')
  try {
    const data = await callCodocsTenantRuntime<{ pending: number, total: number }>(event, '/v1/codocs/issues/pending-count', {
      query: issueRuntimeQuery(query, access.projectCode),
      scope: 'codocs.read'
    })
    return { success: true, data }
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error) {
      throw error
    }
    console.error('Failed to fetch pending issue count:', error)
    return { success: true, data: { pending: 0, total: 0 } }
  }
})
