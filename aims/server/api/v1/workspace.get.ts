/**
 * 智能工作台 — 聚合数据
 * GET /api/v1/workspace
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface TaskRow extends RowDataPacket {
  id: number
  project_id: number
  item_key: string
  tier: string
  type: string
  template_key: string | null
  title: string
  status: string
  priority: string
  due_date: string | null
  estimated_hours: number | null
  created_at: string
  updated_at: string
  project_name: string
}

interface ActivityRow extends RowDataPacket {
  id: number
  work_item_id: number
  field_name: string
  old_value: string | null
  new_value: string | null
  changed_by: string
  changed_at: string
  item_key: string
  title: string
  project_name: string
}

interface CountRow extends RowDataPacket {
  cnt: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  // 我的任务: 未完成的工作项，按优先级和截止日期排序
  const myTasks = await queryRows<TaskRow[]>(
    `SELECT w.id, w.project_id, w.item_key, w.tier, w.type, w.template_key, w.title,
            w.status, w.priority, w.due_date, w.estimated_hours,
            w.created_at, w.updated_at,
            p.name AS project_name
     FROM work_items w
     JOIN aims_projects p ON w.project_id = p.id
     WHERE w.assignee_uid = ?
       AND w.status != 'completed'
     ORDER BY FIELD(w.priority, 'P0', 'P1', 'P2', 'P3'), w.due_date ASC
     LIMIT 20`,
    [uid]
  )

  // 最近动态: 用户所在项目的变更记录，最近7天
  const recentActivity = await queryRows<ActivityRow[]>(
    `SELECT c.id, c.work_item_id, c.field_name, c.old_value, c.new_value,
            c.changed_by, c.changed_at,
            w.item_key, w.title,
            p.name AS project_name
     FROM work_item_changelog c
     JOIN work_items w ON c.work_item_id = w.id
     JOIN aims_projects p ON w.project_id = p.id
     WHERE w.project_id IN (
       SELECT project_id FROM aims_project_members WHERE uid = ?
     )
       AND c.changed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
     ORDER BY c.changed_at DESC
     LIMIT 20`,
    [uid]
  )

  // 统计数据
  const [todoResult] = await queryRows<CountRow[]>(
    `SELECT COUNT(*) AS cnt FROM work_items
     WHERE assignee_uid = ? AND status = 'todo'`,
    [uid]
  )
  const [inProgressResult] = await queryRows<CountRow[]>(
    `SELECT COUNT(*) AS cnt FROM work_items
     WHERE assignee_uid = ? AND status = 'in_progress'`,
    [uid]
  )
  const [doneThisWeekResult] = await queryRows<CountRow[]>(
    `SELECT COUNT(*) AS cnt FROM work_items
     WHERE assignee_uid = ?
       AND status = 'completed'
       AND updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
    [uid]
  )
  const [dueTodayResult] = await queryRows<CountRow[]>(
    `SELECT COUNT(*) AS cnt FROM work_items
     WHERE assignee_uid = ?
       AND status != 'completed'
       AND DATE(due_date) = CURDATE()`,
    [uid]
  )

  return {
    code: 0,
    data: {
      myTasks: myTasks.map(t => ({
        id: t.id,
        projectId: t.project_id,
        itemKey: t.item_key,
        tier: t.tier,
        type: t.type,
        templateKey: t.template_key,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.due_date,
        estimatedHours: t.estimated_hours,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        projectName: t.project_name
      })),
      recentActivity: recentActivity.map(a => ({
        id: a.id,
        workItemId: a.work_item_id,
        fieldName: a.field_name,
        oldValue: a.old_value,
        newValue: a.new_value,
        changedBy: a.changed_by,
        changedAt: a.changed_at,
        itemKey: a.item_key,
        title: a.title,
        projectName: a.project_name
      })),
      stats: {
        todo: todoResult?.cnt ?? 0,
        inProgress: inProgressResult?.cnt ?? 0,
        doneThisWeek: doneThisWeekResult?.cnt ?? 0,
        dueToday: dueTodayResult?.cnt ?? 0
      }
    }
  }
})
