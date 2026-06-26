/**
 * 删除项目
 * DELETE /api/v1/projects/:id
 *
 * 仅允许草稿状态物理删除（及其全部关联数据）；非草稿状态一律拒绝，不做软删除/归档
 * 仅 manager 角色可操作
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { hardDeleteProject } from '~~/server/utils/projectDeletion'
import { requireProjectManager } from '~~/server/utils/projectPermission'

interface ProjectRow extends RowDataPacket {
  id: number
  lifecycle_status: string
}

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const project = await queryRow<ProjectRow>(
    'SELECT id, lifecycle_status FROM aims_projects WHERE id = ?',
    [id]
  )
  if (!project) {
    throw createError({ statusCode: 404, message: '项目不存在' })
  }

  // 仅允许草稿状态删除；非草稿一律不允许（含归档状态）
  if (project.lifecycle_status !== 'draft') {
    throw createError({
      statusCode: 409,
      message: '仅草稿状态的项目可以删除，非草稿项目不允许删除或归档'
    })
  }

  await requireProjectManager(event, id, '仅项目经理可以删除项目')

  const deleted = await hardDeleteProject(id)

  return {
    code: 0,
    data: { deleted }
  }
})
