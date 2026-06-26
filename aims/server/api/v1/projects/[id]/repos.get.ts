/**
 * 获取项目关联仓库列表
 * GET /api/v1/projects/:id/repos
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface RepoRow extends RowDataPacket {
  id: number
  project_id: number
  repo_project_code: string
  last_commit_sha: string | null
  last_synced_at: string | null
  created_at: string
}

interface ProjectExistsRow extends RowDataPacket {
  id: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  // 检查项目是否存在
  const project = await queryRow<ProjectExistsRow>(
    'SELECT id FROM aims_projects WHERE id = ?',
    [id]
  )
  if (!project) {
    throw createError({ statusCode: 404, message: '项目不存在' })
  }

  const repos = await queryRows<RepoRow[]>(
    'SELECT * FROM aims_project_repos WHERE project_id = ? ORDER BY created_at',
    [id]
  )

  return {
    code: 0,
    data: repos.map(r => ({
      id: r.id,
      projectId: r.project_id,
      repoProjectCode: r.repo_project_code,
      lastCommitSha: r.last_commit_sha,
      lastSyncedAt: r.last_synced_at,
      createdAt: r.created_at
    }))
  }
})
