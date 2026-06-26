/**
 * 获取任务关联的 GitLab 提交
 * GET /api/v1/work-items/:id/commits
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface CommitRow extends RowDataPacket {
  id: number
  repo_project_code: string
  commit_sha: string
  message: string
  author_name: string | null
  author_email: string | null
  committed_at: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const workItemId = Number(getRouterParam(event, 'id'))
  if (!workItemId || Number.isNaN(workItemId)) {
    throw createError({ statusCode: 400, message: '无效的工作项ID' })
  }

  const commits = await queryRows<CommitRow[]>(
    `SELECT id, repo_project_code, commit_sha, message, author_name, author_email, committed_at
     FROM gitlab_commits
     WHERE work_item_id = ?
     ORDER BY committed_at DESC`,
    [workItemId]
  )

  return {
    code: 0,
    data: commits.map(c => ({
      id: c.id,
      repoProjectCode: c.repo_project_code,
      commitSha: c.commit_sha,
      message: c.message,
      authorName: c.author_name,
      authorEmail: c.author_email,
      committedAt: c.committed_at
    }))
  }
})
