/**
 * 仓库 Markdown 文档内容接口（Foundation Git integration）
 * GET /api/account/projects/doc/:projectCode?path=xxx&ref=xxx&commit_id=xxx
 */
import type { ApiResponse } from '~/types/account'
import { getGitRepositoryFile } from '@hzy/foundation/server/utils/gitIntegration'

export default defineEventHandler(async (event) => {
  const projectCode = getRouterParam(event, 'projectCode') || ''
  const query = getQuery(event)

  try {
    const data = await getGitRepositoryFile({
      projectCode,
      path: String(query.path || ''),
      ref: typeof query.ref === 'string' ? query.ref : undefined,
      commitId: typeof query.commit_id === 'string' ? query.commit_id : typeof query.commitId === 'string' ? query.commitId : undefined
    })
    return { code: 0, message: 'success', data } satisfies ApiResponse<unknown>
  } catch (error: unknown) {
    const err = error as { message?: string, statusCode?: number }
    throw createError({
      statusCode: err.statusCode || 500,
      message: err.message || 'Failed to fetch repo doc content'
    })
  }
})
