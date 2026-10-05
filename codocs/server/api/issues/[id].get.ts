/**
 * 获取 Issue 详情（含评论）
 * GET /api/issues/:id
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { issueProjectCode, issueRuntimeQuery, resolveIssueProjectAccess } from '~~/server/utils/issueProjectAccess'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '缺少Issue ID' })
  }
  const query = getQuery(event)
  const access = await resolveIssueProjectAccess(event, issueProjectCode(query.project_code || query.projectCode), 'view')

  try {
    const issue = await callCodocsTenantRuntime<Record<string, unknown>>(event, `/v1/codocs/issues/${encodeURIComponent(id)}`, {
      query: issueRuntimeQuery(query, access.projectCode),
      scope: 'codocs.read'
    })

    return {
      success: true,
      data: issue
    }
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error) {
      throw error
    }
    console.error('Failed to fetch issue:', error)
    throw createError({ statusCode: 500, message: '获取Issue详情失败' })
  }
})
