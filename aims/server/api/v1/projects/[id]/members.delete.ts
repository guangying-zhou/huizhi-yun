/**
 * 移除/暂停项目成员
 * DELETE /api/v1/projects/:id/members?uid=xxx&action=remove|suspend
 *
 * action=remove: 直接删除（仅无工作项时允许）
 * action=suspend: 暂停成员（有工作项时使用）
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { requireProjectManager } from '~~/server/utils/projectPermission'

interface MemberRow extends RowDataPacket {
  role: string
}

interface ProjectExistsRow extends RowDataPacket {
  id: number
}

interface CountRow extends RowDataPacket {
  cnt: number
}

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const query = getQuery(event)
  const targetUid = query.uid as string
  const action = (query.action as string) || 'remove'

  if (!targetUid) {
    throw createError({ statusCode: 400, message: '请指定要操作的用户UID' })
  }

  // 检查项目是否存在
  const project = await queryRow<ProjectExistsRow>(
    'SELECT id FROM aims_projects WHERE id = ?',
    [id]
  )
  if (!project) {
    throw createError({ statusCode: 404, message: '项目不存在' })
  }

  const { uid } = await requireProjectManager(event, id, '仅项目经理可以管理成员')

  // 不能操作自己
  if (targetUid === uid) {
    throw createError({ statusCode: 400, message: '不能移除自己，请先转让项目经理角色' })
  }

  // 检查目标用户是否是成员
  const targetMember = await queryRow<MemberRow>(
    'SELECT role FROM aims_project_members WHERE project_id = ? AND uid = ?',
    [id, targetUid]
  )
  if (!targetMember) {
    throw createError({ statusCode: 404, message: '该用户不是项目成员' })
  }

  if (action === 'suspend') {
    // 暂停成员
    await execute(
      'UPDATE aims_project_members SET status = ? WHERE project_id = ? AND uid = ?',
      ['suspended', id, targetUid]
    )
    return { code: 0, data: { action: 'suspended' } }
  }

  // action === 'remove'：检查是否有关联工作项
  const workItemCount = await queryRow<CountRow>(
    'SELECT COUNT(*) AS cnt FROM work_items WHERE project_id = ? AND assignee_uid = ?',
    [id, targetUid]
  )

  if (workItemCount && workItemCount.cnt > 0) {
    // 有工作项，不允许直接移除
    return {
      code: 1,
      message: '该成员名下有工作项，不可直接移除，只能暂停',
      data: { workItemCount: workItemCount.cnt }
    }
  }

  // 无工作项，直接删除
  await execute(
    'DELETE FROM aims_project_members WHERE project_id = ? AND uid = ?',
    [id, targetUid]
  )

  return { code: 0, data: { action: 'removed' } }
})
