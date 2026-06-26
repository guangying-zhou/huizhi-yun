/**
 * 获取项目的 GitLab 提交列表（用于关联选择）
 * GET /api/v1/projects/:id/gitlab-commits?unlinked=true&keyword=xxx
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface CommitRow extends RowDataPacket {
  id: number
  work_item_id: number | null
  item_key: string | null
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

  const projectId = Number(getRouterParam(event, 'id'))
  if (!projectId || Number.isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const query = getQuery(event)
  const unlinked = query.unlinked === 'true'
  const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : ''

  let sql = `SELECT id, work_item_id, item_key, repo_project_code, commit_sha, message,
                    author_name, author_email, committed_at
             FROM gitlab_commits
             WHERE project_id = ?`
  const params: unknown[] = [projectId]

  // exclude_work_item_id: 排除已关联到指定工作项的提交
  const excludeWorkItemId = typeof query.exclude_work_item_id === 'string' ? Number(query.exclude_work_item_id) : null
  if (unlinked && excludeWorkItemId) {
    // 显示未关联的 + 已关联到其他工作项的，但排除已关联到当前工作项的
    sql += ' AND (work_item_id IS NULL OR work_item_id != ?)'
    params.push(excludeWorkItemId)
  } else if (unlinked) {
    sql += ' AND work_item_id IS NULL'
  }

  // 按用户过滤：uid 匹配 author_name
  const uidFilter = typeof query.uid === 'string' ? query.uid.trim() : ''
  if (uidFilter) {
    sql += ' AND author_name = ?'
    params.push(uidFilter)
  }

  if (keyword) {
    sql += ' AND (message LIKE ? OR commit_sha LIKE ? OR author_name LIKE ?)'
    const like = `%${keyword}%`
    params.push(like, like, like)
  }

  sql += ' ORDER BY committed_at DESC LIMIT 100'

  const commits = await queryRows<CommitRow[]>(sql, params)

  return {
    code: 0,
    data: commits.map(c => ({
      id: c.id,
      workItemId: c.work_item_id,
      itemKey: c.item_key,
      repoProjectCode: c.repo_project_code,
      commitSha: c.commit_sha,
      message: c.message,
      authorName: c.author_name,
      authorEmail: c.author_email,
      committedAt: c.committed_at
    }))
  }
})
