/**
 * 查询需求变更对关联任务的影响
 * GET /api/v1/requirements/:reqId/change-impact
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface TaskRow extends RowDataPacket {
  id: number
  item_key: string
  title: string
  status: string
  assignee_uid: string | null
  type: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const reqId = Number(getRouterParam(event, 'reqId'))
  if (!reqId || Number.isNaN(reqId)) {
    throw createError({ statusCode: 400, message: '无效的需求ID' })
  }

  const tasks = await queryRows<TaskRow[]>(
    `SELECT id, item_key, title, status, assignee_uid, type
     FROM work_items
     WHERE requirement_id = ? AND type IN ('task', 'change_request')
     ORDER BY created_at`,
    [reqId]
  )

  const linkedTasks = tasks.map((t) => {
    let impactCategory: string
    if (!t.assignee_uid || t.status === 'planning' || t.status === 'todo') {
      impactCategory = 'safe_to_update'
    } else if (t.status === 'in_progress' || t.status === 'in_review') {
      impactCategory = 'user_choice'
    } else {
      impactCategory = 'force_change_request'
    }

    return {
      id: t.id,
      itemKey: t.item_key,
      title: t.title,
      status: t.status,
      assigneeUid: t.assignee_uid,
      type: t.type,
      impactCategory
    }
  })

  let recommendation = 'direct_update'
  if (linkedTasks.some(t => t.impactCategory === 'force_change_request')) {
    recommendation = linkedTasks.every(t => t.impactCategory === 'force_change_request')
      ? 'change_request_only'
      : 'mixed'
  } else if (linkedTasks.some(t => t.impactCategory === 'user_choice')) {
    recommendation = 'mixed'
  }

  return {
    code: 0,
    data: { linkedTasks, recommendation }
  }
})
