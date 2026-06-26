/**
 * 系统管理员彻底删除项目
 * DELETE /api/v1/admin/projects/:id
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { getProjectDeletionImpact, hardDeleteProject } from '~~/server/utils/projectDeletion'
import { requireGlobalProjectAdmin } from '~~/server/utils/projectPermission'

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
  name: string
}

export default defineEventHandler(async (event) => {
  await requireGlobalProjectAdmin(event)

  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const project = await queryRow<ProjectRow>(
    'SELECT id, project_code, name FROM aims_projects WHERE id = ?',
    [id]
  )
  if (!project) {
    throw createError({ statusCode: 404, message: '项目不存在' })
  }

  const body = await readBody(event)
  const confirmText = String(body?.confirmText || '').trim()
  if (confirmText !== project.project_code && confirmText !== project.name) {
    throw createError({ statusCode: 400, message: '请输入项目编码或项目名称确认删除' })
  }

  const impact = await getProjectDeletionImpact(id)
  const deleted = await hardDeleteProject(id)

  return {
    code: 0,
    data: {
      projectId: id,
      projectCode: project.project_code,
      impact,
      deleted
    }
  }
})
