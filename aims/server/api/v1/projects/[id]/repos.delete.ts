/**
 * 移除项目仓库关联
 * DELETE /api/v1/projects/:id/repos?repoProjectCode=xxx
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { requireProjectManager } from '~~/server/utils/projectPermission'

interface ProjectExistsRow extends RowDataPacket {
  id: number
}

interface RepoExistsRow extends RowDataPacket {
  id: number
}

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const query = getQuery(event)
  const repoProjectCode = query.repoProjectCode as string
  if (!repoProjectCode) {
    throw createError({ statusCode: 400, message: '请指定要移除的仓库项目编码' })
  }

  // 检查项目是否存在
  const project = await queryRow<ProjectExistsRow>(
    'SELECT id FROM aims_projects WHERE id = ?',
    [id]
  )
  if (!project) {
    throw createError({ statusCode: 404, message: '项目不存在' })
  }

  await requireProjectManager(event, id, '仅项目经理可以管理仓库关联')

  // 检查关联是否存在
  const repo = await queryRow<RepoExistsRow>(
    'SELECT id FROM aims_project_repos WHERE project_id = ? AND repo_project_code = ?',
    [id, repoProjectCode]
  )
  if (!repo) {
    throw createError({ statusCode: 404, message: '该仓库未关联到此项目' })
  }

  await execute(
    'DELETE FROM aims_project_repos WHERE project_id = ? AND repo_project_code = ?',
    [id, repoProjectCode]
  )

  return {
    code: 0,
    data: null
  }
})
