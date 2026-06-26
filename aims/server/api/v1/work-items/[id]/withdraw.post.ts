/**
 * 撤回工作项分解审批
 * POST /api/v1/work-items/:id/withdraw
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface ItemRow extends RowDataPacket {
  id: number
  project_id: number
  approval_status: string
}

interface ApprovalRow extends RowDataPacket {
  id: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const workItemId = Number(getRouterParam(event, 'id'))
  if (!workItemId || Number.isNaN(workItemId)) {
    throw createError({ statusCode: 400, message: '无效的工作项ID' })
  }

  const item = await queryRow<ItemRow>(
    'SELECT id, project_id, approval_status FROM work_items WHERE id = ?',
    [workItemId]
  )
  if (!item) {
    throw createError({ statusCode: 404, message: '工作项不存在' })
  }
  if (item.approval_status !== 'pending') {
    throw createError({ statusCode: 400, message: '当前工作项未处于待审批状态' })
  }

  const approval = await queryRow<ApprovalRow>(
    `SELECT id
     FROM approval_records
     WHERE project_id = ?
       AND work_item_owner_id = ?
       AND status = 'pending'
       AND requested_by = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [item.project_id, workItemId, uid]
  )
  if (!approval) {
    throw createError({ statusCode: 404, message: '未找到可撤回的审批记录' })
  }

  await execute(
    `UPDATE approval_records
     SET status = 'cancelled', reviewed_at = NOW(), review_comment = '发起人撤回'
     WHERE id = ?`,
    [approval.id]
  )

  await execute(
    'UPDATE work_items SET approval_status = ? WHERE id = ?',
    ['not_required', workItemId]
  )

  return {
    code: 0,
    data: null
  }
})
