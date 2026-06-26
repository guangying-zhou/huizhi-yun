/**
 * 获取 GitLab 提交的 diff
 * GET /api/v1/work-items/:id/commits/:commitId/diff
 *
 * 通过 Foundation Git integration 获取 GitLab commit diff
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { getGitCommitDiff } from '@hzy/foundation/server/utils/gitIntegration'

interface CommitRow extends RowDataPacket {
  commit_sha: string
  repo_project_code: string
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

  const commitId = Number(getRouterParam(event, 'commitId'))
  if (!commitId) {
    throw createError({ statusCode: 400, message: '参数无效' })
  }

  const commit = await queryRow<CommitRow>(
    'SELECT commit_sha, repo_project_code FROM gitlab_commits WHERE id = ?',
    [commitId]
  )
  if (!commit) {
    throw createError({ statusCode: 404, message: '提交记录不存在' })
  }

  try {
    const data = await getGitCommitDiff({
      projectCode: commit.repo_project_code,
      sha: commit.commit_sha
    }) as DiffItem[]

    // 顺便更新文件数到数据库
    if (data.length) {
      execute(
        'UPDATE gitlab_commits SET files_changed = ? WHERE id = ?',
        [data.length, commitId]
      ).catch(() => {})
    }

    return { code: 0, data }
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || (err as Error).message || '获取 diff 失败'
    throw createError({ statusCode: 502, message: msg })
  }
})
