/**
 * 审核处理（通过/驳回）
 * PUT /api/v1/approvals/:id
 * Body: { status: 'approved' | 'rejected', reviewComment?: string }
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { initializeProjectMilestonesOnActivation } from '~~/server/utils/projectMilestones'

interface ApprovalRow extends RowDataPacket {
  id: number
  project_owner_id: number | null
  milestone_owner_id: number | null
  work_item_owner_id: number | null
  transition: string
  reviewer_uid: string | null
  status: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的审核ID' })
  }

  const body = await readBody(event)
  if (!body.status || !['approved', 'rejected'].includes(body.status)) {
    throw createError({ statusCode: 400, message: 'status 必须为 approved 或 rejected' })
  }

  // 查询审核记录
  const approval = await queryRow<ApprovalRow>(
    'SELECT * FROM approval_records WHERE id = ?',
    [id]
  )
  if (!approval) {
    throw createError({ statusCode: 404, message: '审核记录不存在' })
  }
  if (approval.status !== 'pending') {
    throw createError({ statusCode: 400, message: '该审核已处理' })
  }
  if (approval.reviewer_uid && approval.reviewer_uid !== uid) {
    throw createError({ statusCode: 403, message: '您不是该审核的指定审核人' })
  }

  // 更新审核记录
  await execute(
    `UPDATE approval_records
     SET status = ?, reviewer_uid = ?, reviewed_at = NOW(), review_comment = ?
     WHERE id = ?`,
    [body.status, uid, body.reviewComment || null, id]
  )

  const entityType = approval.project_owner_id !== null
    ? 'project'
    : approval.milestone_owner_id !== null
      ? 'milestone'
      : 'work_item'
  const entityId = approval.project_owner_id
    ?? approval.milestone_owner_id
    ?? approval.work_item_owner_id

  // 审核通过时，自动流转实体状态
  if (body.status === 'approved' && entityId) {
    if (entityType === 'project') {
      await execute(
        'UPDATE aims_projects SET lifecycle_status = ? WHERE id = ?',
        ['active', entityId]
      )
      await initializeProjectMilestonesOnActivation(entityId)
    } else if (entityType === 'milestone') {
      await execute(
        'UPDATE milestones SET status = ? WHERE id = ?',
        ['completed', entityId]
      )
    } else if (entityType === 'work_item') {
      if (approval.transition === 'complete') {
        await execute(
          'UPDATE work_items SET approval_status = ?, status = ? WHERE id = ?',
          ['approved', 'completed', entityId]
        )
      } else {
        await execute(
          'UPDATE work_items SET approval_status = ? WHERE id = ?',
          ['approved', entityId]
        )
      }
    }
  }

  // 审核驳回时，回退实体状态
  if (body.status === 'rejected' && entityId) {
    if (entityType === 'project') {
      await execute(
        'UPDATE aims_projects SET lifecycle_status = ? WHERE id = ?',
        ['draft', entityId]
      )
    } else if (entityType === 'work_item') {
      if (approval.transition === 'complete') {
        await execute(
          'UPDATE work_items SET approval_status = ?, status = ? WHERE id = ?',
          ['rejected', 'in_progress', entityId]
        )
      } else {
        await execute(
          'UPDATE work_items SET approval_status = ? WHERE id = ?',
          ['rejected', entityId]
        )
      }
    }
  }

  return {
    code: 0,
    data: null
  }
})
