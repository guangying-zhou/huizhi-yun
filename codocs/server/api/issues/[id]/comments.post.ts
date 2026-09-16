/**
 * 添加 Issue 评论
 * POST /api/issues/:id/comments
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { issueProjectCode, issueRuntimeQuery, resolveIssueProjectAccess } from '~~/server/utils/issueProjectAccess'

export default defineEventHandler(async (event) => {
  const issueId = getRouterParam(event, 'id')
  const body = await readBody<Record<string, unknown>>(event)
  const { content } = body

  if (!issueId || !content) {
    throw createError({ statusCode: 400, message: '缺少必填字段：issue id, content' })
  }
  const access = await resolveIssueProjectAccess(event, issueProjectCode(body.project_code || body.projectCode), 'view')

  try {
    const result = await callCodocsTenantRuntime<{ id: number }>(event, `/v1/codocs/issues/${encodeURIComponent(String(issueId))}/comments`, {
      method: 'POST',
      query: issueRuntimeQuery({}, access.projectCode),
      scope: 'codocs.write',
      body: { content }
    })

    return {
      success: true,
      data: { id: result.id },
      message: '评论已添加'
    }
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error) {
      throw error
    }
    console.error('Failed to add comment:', error)
    throw createError({ statusCode: 500, message: '添加评论失败' })
  }
})
