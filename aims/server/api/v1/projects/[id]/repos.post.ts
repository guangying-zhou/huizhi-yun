/**
 * 关联仓库到项目
 * POST /api/v1/projects/:id/repos
 * Body: { repoProjectCode: string }
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { requireProjectManager } from '~~/server/utils/projectPermission'

interface ProjectExistsRow extends RowDataPacket {
  id: number
}

interface DuplicateCheckRow extends RowDataPacket {
  cnt: number
}

export default defineEventHandler(async (event) => {
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

  await requireProjectManager(event, id, '仅项目经理可以管理仓库关联')

  const body = await readBody(event)
  if (!body?.repoProjectCode) {
    throw createError({ statusCode: 400, message: '仓库项目编码为必填项' })
  }

  // 检查是否已关联
  const dupCheck = await queryRow<DuplicateCheckRow>(
    'SELECT COUNT(*) AS cnt FROM aims_project_repos WHERE project_id = ? AND repo_project_code = ?',
    [id, body.repoProjectCode]
  )
  if (dupCheck && dupCheck.cnt > 0) {
    throw createError({ statusCode: 400, message: '该仓库已关联到此项目' })
  }

  await execute(
    'INSERT INTO aims_project_repos (project_id, repo_project_code) VALUES (?, ?)',
    [id, body.repoProjectCode]
  )

  return {
    code: 0,
    data: null
  }
})
