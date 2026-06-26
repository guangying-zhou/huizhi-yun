/**
 * 获取项目成员列表
 * GET /api/v1/projects/:id/members
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { normalizeProjectRole } from '~~/app/utils/projectRoles'

interface MemberRow extends RowDataPacket {
  id: number
  project_id: number
  uid: string
  role: string
  status: string
  joined_at: string
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

  const members = await queryRows<MemberRow[]>(
    'SELECT * FROM aims_project_members WHERE project_id = ? ORDER BY joined_at',
    [id]
  )

  return {
    code: 0,
    data: members.map(m => ({
      id: m.id,
      projectId: m.project_id,
      uid: m.uid,
      role: normalizeProjectRole(m.role),
      status: m.status || 'active',
      joinedAt: m.joined_at
    }))
  }
})
