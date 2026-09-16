/**
 * 仓库 Markdown 文档内容接口（Foundation Git integration）
 * GET /api/account/projects/doc/:projectCode?path=xxx&ref=xxx&commit_id=xxx
 */
import type { ApiResponse } from '~/types/account'
import { getGitRepositoryFile } from '@hzy/foundation/server/utils/gitIntegration'

export default defineEventHandler(async (event) => {
  const uid = await requireAimsSessionUid(event)
  const projectCode = getRouterParam(event, 'projectCode', { decode: true }) || ''
  const query = getQuery(event)
  const aimsProjectId = Number(query.aimsProjectId ?? query.aims_project_id)

  if (!Number.isInteger(aimsProjectId) || aimsProjectId <= 0) {
    throw createError({ statusCode: 400, message: 'aimsProjectId is required' })
  }
  await assertAimsProjectRepositoryAccess(event, aimsProjectId, projectCode, uid)

  try {
    const data = await getGitRepositoryFile({
      repoPath: projectCode,
      path: String(query.path || ''),
      ref: typeof query.ref === 'string' ? query.ref : undefined,
      commitId: typeof query.commit_id === 'string' ? query.commit_id : typeof query.commitId === 'string' ? query.commitId : undefined
    })
    return {
      code: 0,
      message: 'success',
      data: {
        path: data.path,
        name: data.name,
        size: data.size,
        encoding: data.encoding,
        content: data.content,
        ref: data.ref,
        blob_id: data.blobId,
        commit_id: data.commitId,
        last_commit_id: data.lastCommitId
      }
    } satisfies ApiResponse<unknown>
  } catch (error: unknown) {
    const err = error as { message?: string, statusCode?: number }
    throw createError({
      statusCode: err.statusCode || 500,
      message: err.message || 'Failed to fetch repo doc content'
    })
  }
})
