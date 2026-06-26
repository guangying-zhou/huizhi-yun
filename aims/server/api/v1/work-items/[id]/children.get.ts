/**
 * 获取工作项的直接子任务列表（轻量版，用于 target 信息弹窗 / append 页）
 * GET /api/v1/work-items/:id/children
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { hasWorkItemStartDateColumn } from '~~/server/utils/workItemStartDate'

interface ChildRow extends RowDataPacket {
  id: number
  item_key: string
  title: string
  status: string
  assignee_uid: string | null
  assignee_name: string | null
  estimated_hours: number | null
  start_date: string | null
  due_date: string | null
  description: string | null
  priority: string
  approval_status: string
  created_at: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }
  const id = Number(getRouterParam(event, 'id'))
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的工作项ID' })
  }

  const supportsStartDate = await hasWorkItemStartDateColumn()
  const rows = await queryRows<ChildRow[]>(
    `SELECT
        wi.id,
        wi.item_key,
        wi.title,
        wi.status,
        wi.assignee_uid,
        NULL AS assignee_name,
        wi.estimated_hours,
        ${supportsStartDate ? 'wi.start_date' : 'NULL AS start_date'},
        wi.due_date,
        wi.description,
        wi.priority,
        wi.approval_status,
        wi.created_at
     FROM work_items wi
     WHERE wi.parent_id = ?
     ORDER BY wi.sort_order ASC, wi.created_at ASC`,
    [id]
  )

  return {
    code: 0,
    data: rows.map(r => ({
      id: r.id,
      itemKey: r.item_key,
      title: r.title,
      status: r.status,
      assigneeUid: r.assignee_uid,
      assigneeName: r.assignee_name,
      estimatedHours: r.estimated_hours === null ? null : Number(r.estimated_hours),
      startDate: r.start_date,
      dueDate: r.due_date,
      description: r.description,
      priority: r.priority,
      approvalStatus: r.approval_status,
      createdAt: r.created_at
    }))
  }
})
