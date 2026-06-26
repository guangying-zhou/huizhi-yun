/**
 * 添加项目成员
 * POST /api/v1/projects/:id/members
 * Body: { uid: string, role?: ProjectRole }
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { requireProjectManager } from '~~/server/utils/projectPermission'
import { normalizeProjectRole } from '~~/app/utils/projectRoles'

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

  await requireProjectManager(event, id, '仅项目经理可以管理成员')

  const body = await readBody(event)
  if (!body?.uid) {
    throw createError({ statusCode: 400, message: '用户UID为必填项' })
  }

  const role = normalizeProjectRole(typeof body.role === 'string' ? body.role : 'member')
  const validRoles = ['manager', 'member', 'viewer']
  if (!validRoles.includes(role)) {
    throw createError({ statusCode: 400, message: `无效的角色: ${role}` })
  }

  // 检查是否已是成员
  const dupCheck = await queryRow<DuplicateCheckRow>(
    'SELECT COUNT(*) AS cnt FROM aims_project_members WHERE project_id = ? AND uid = ?',
    [id, body.uid]
  )
  if (dupCheck && dupCheck.cnt > 0) {
    throw createError({ statusCode: 400, message: '该用户已是项目成员' })
  }

  await execute(
    'INSERT INTO aims_project_members (project_id, uid, role) VALUES (?, ?, ?)',
    [id, body.uid, role]
  )

  return {
    code: 0,
    data: null
  }
})
