/**
 * 更新工作项审批状态
 * PATCH /api/v1/work-items/:id/approval-status
 *
 * 供 workflow 回调或前端流程组件同步状态使用
 */
export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const workItemId = Number(getRouterParam(event, 'id'))
  if (!workItemId || Number.isNaN(workItemId)) {
    throw createError({ statusCode: 400, message: '无效的工作项ID' })
  }

  const body = await readBody<{ approvalStatus: string, status?: string }>(event)
  const allowedApproval = ['not_required', 'pending', 'approved', 'rejected']
  if (!body.approvalStatus || !allowedApproval.includes(body.approvalStatus)) {
    throw createError({ statusCode: 400, message: `approvalStatus 必须是 ${allowedApproval.join('/')} 之一` })
  }

  if (body.status) {
    const allowedStatus = ['planning', 'todo', 'in_progress', 'in_review', 'completed']
    if (!allowedStatus.includes(body.status)) {
      throw createError({ statusCode: 400, message: `status 必须是 ${allowedStatus.join('/')} 之一` })
    }
    await execute(
      'UPDATE work_items SET approval_status = ?, status = ? WHERE id = ?',
      [body.approvalStatus, body.status, workItemId]
    )
    // 同步更新子任务状态（仅更新尚未开始的子任务）
    await execute(
      'UPDATE work_items SET status = ? WHERE parent_id = ? AND status IN (?, ?)',
      [body.status, workItemId, 'planning', 'todo']
    )
  } else {
    await execute(
      'UPDATE work_items SET approval_status = ? WHERE id = ?',
      [body.approvalStatus, workItemId]
    )
  }

  return { code: 0, data: null }
})
