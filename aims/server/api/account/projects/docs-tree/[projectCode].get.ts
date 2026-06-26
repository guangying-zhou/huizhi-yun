/**
 * 仓库 Markdown 文档清单接口（Foundation Git integration）
 * GET /api/account/projects/docs-tree/:projectCode?ref=xxx
 */
import type { ApiResponse } from '~/types/account'
import { listGitMarkdownTree } from '@hzy/foundation/server/utils/gitIntegration'

export default defineEventHandler(async (event) => {
  const projectCode = getRouterParam(event, 'projectCode') || ''
  const query = getQuery(event)

  try {
    const data = await listGitMarkdownTree({
      projectCode,
      ref: typeof query.ref === 'string' ? query.ref : undefined
    })
    return { code: 0, message: 'success', data } satisfies ApiResponse<unknown>
  } catch (error: unknown) {
    const err = error as { message?: string, statusCode?: number }
    throw createError({
      statusCode: err.statusCode || 500,
      message: err.message || 'Failed to fetch repo docs-tree'
    })
  }
})
