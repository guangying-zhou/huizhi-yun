/**
 * 获取用户个人工时记录
 * GET /api/v1/users/:uid/time-entries?startDate=xxx&endDate=xxx
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface TimeEntryWithItemRow extends RowDataPacket {
  id: number
  project_id: number
  work_item_id: number | null
  uid: string
  entry_date: string
  hours: number
  description: string | null
  created_at: string
  updated_at: string
  item_key: string | null
  title: string | null
  project_code: string
  project_name: string
  project_short_name: string
}

export default defineEventHandler(async (event) => {
  const authUser = getRequestUid(event)
  if (!authUser) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const uid = getRouterParam(event, 'uid')
  if (!uid) {
    throw createError({ statusCode: 400, message: '无效的用户ID' })
  }

  const query = getQuery(event)
  const startDate = query.startDate as string | undefined
  const endDate = query.endDate as string | undefined

  const conditions: string[] = ['t.uid = ?']
  const params: unknown[] = [uid]

  if (startDate) {
    conditions.push('t.entry_date >= ?')
    params.push(startDate)
  }
  if (endDate) {
    conditions.push('t.entry_date <= ?')
    params.push(endDate)
  }

  const sql = `
    SELECT
      t.id,
      t.project_id,
      t.work_item_id,
      t.uid,
      t.entry_date,
      t.hours,
      t.description,
      t.created_at,
      t.updated_at,
      w.item_key,
      w.title,
      p.project_code,
      p.name AS project_name,
      p.short_name AS project_short_name
    FROM time_entries t
    LEFT JOIN work_items w ON t.work_item_id = w.id
    JOIN aims_projects p ON p.id = t.project_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.entry_date DESC, t.created_at DESC
  `

  const entries = await queryRows<TimeEntryWithItemRow[]>(sql, params)

  return {
    code: 0,
    data: entries.map(e => ({
      id: e.id,
      workItemId: e.work_item_id,
      projectId: e.project_id,
      projectCode: e.project_code,
      projectName: e.project_name,
      projectShortName: e.project_short_name,
      uid: e.uid,
      entryDate: e.entry_date,
      hours: e.hours,
      description: e.description,
      createdAt: e.created_at,
      updatedAt: e.updated_at,
      itemKey: e.item_key,
      title: e.title,
      itemTitle: e.title
    }))
  }
})
