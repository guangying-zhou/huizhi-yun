/**
 * 删除里程碑
 * DELETE /api/v1/milestones/:id
 * milestone_id 是 work_items 的 RESTRICT 外键，有工作项时不允许删除
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface MilestoneRow extends RowDataPacket {
  id: number
}

interface CountRow extends RowDataPacket {
  cnt: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const milestoneId = Number(getRouterParam(event, 'id'))
  if (!milestoneId || isNaN(milestoneId)) {
    throw createError({ statusCode: 400, message: '无效的里程碑ID' })
  }

  const milestone = await queryRow<MilestoneRow>(
    'SELECT id FROM milestones WHERE id = ?',
    [milestoneId]
  )
  if (!milestone) {
    throw createError({ statusCode: 404, message: '里程碑不存在' })
  }

  // 检查是否有关联工作项（RESTRICT 外键，不允许级联删除）
  const workItemCount = await queryRow<CountRow>(
    'SELECT COUNT(*) AS cnt FROM work_items WHERE milestone_id = ?',
    [milestoneId]
  )
  if (workItemCount && workItemCount.cnt > 0) {
    throw createError({
      statusCode: 400,
      message: `该里程碑下有 ${workItemCount.cnt} 个工作项，请先移动或删除后再删除里程碑`
    })
  }

  await execute('DELETE FROM milestones WHERE id = ?', [milestoneId])

  return { code: 0, data: null }
})
