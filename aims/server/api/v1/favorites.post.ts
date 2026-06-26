/**
 * 添加常用项目
 * POST /api/v1/favorites
 * Body: { projectId: number }
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface ProjectRow extends RowDataPacket {
  id: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const body = await readBody(event)
  const projectId = Number(body.projectId)
  if (!projectId || isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  // 检查项目是否存在
  const project = await queryRow<ProjectRow>(
    'SELECT id FROM aims_projects WHERE id = ?',
    [projectId]
  )
  if (!project) {
    throw createError({ statusCode: 404, message: '项目不存在' })
  }

  // INSERT IGNORE 避免重复
  await execute(
    'INSERT IGNORE INTO user_favorite_projects (uid, project_id) VALUES (?, ?)',
    [uid, projectId]
  )

  return { code: 0, data: null }
})
