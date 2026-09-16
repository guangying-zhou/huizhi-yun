/**
 * 获取 GitLab 提交的 diff
 * GET /api/v1/work-items/:id/commits/:commitId/diff
 *
 * Aims BFF keeps the Git integration call, but commit metadata and file-count
 * persistence are served by tenant-runtime/data-runtime.
 */
import { getGitCommitDiff } from '@hzy/foundation/server/utils/gitIntegration'
import { buildAimsProjectListRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'
import { forwardAimsRuntimeGet, forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface CommitDiffMetadata {
  repoProjectCode?: string
  repo_project_code?: string
  commitSha?: string
  commit_sha?: string
}

interface DiffItem {
  oldPath: string
  newPath: string
  newFile: boolean
  renamedFile: boolean
  deletedFile: boolean
  diff: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const workItemId = Number(getRouterParam(event, 'id'))
  const commitId = Number(getRouterParam(event, 'commitId'))
  if (!workItemId || !commitId) {
    throw createError({ statusCode: 400, message: '参数无效' })
  }

  const accessQuery = await buildAimsProjectListRuntimeAccessQuery(event, {
    uid,
    baseQuery: { operator_uid: uid }
  })
  const commit = await forwardAimsRuntimeGet<CommitDiffMetadata>(
    event,
    `/v1/aims/work-items/${encodeURIComponent(String(workItemId))}/commits/${encodeURIComponent(String(commitId))}/diff-metadata`,
    { uid, query: accessQuery }
  )
  const repoProjectCode = String(commit.repoProjectCode || commit.repo_project_code || '').trim()
  const commitSha = String(commit.commitSha || commit.commit_sha || '').trim()
  if (!repoProjectCode || !commitSha) {
    throw createError({ statusCode: 502, message: '提交记录缺少仓库或 SHA 信息' })
  }

  try {
    const data = await getGitCommitDiff({
      repoPath: repoProjectCode,
      sha: commitSha
    }) as DiffItem[]

    if (data.length) {
      try {
        await forwardAimsRuntimePost(
          event,
          `/v1/aims/work-items/${encodeURIComponent(String(workItemId))}/commits/${encodeURIComponent(String(commitId))}/files-changed`,
          {
            uid,
            query: accessQuery,
            body: { filesChanged: data.length }
          }
        )
      } catch {
        // Diff rendering must not fail just because the cached file count did not persist.
      }
    }

    return { code: 0, data }
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || (err as Error).message || '获取 diff 失败'
    throw createError({ statusCode: 502, message: msg })
  }
})
