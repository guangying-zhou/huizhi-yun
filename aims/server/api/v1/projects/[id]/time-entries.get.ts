/**
 * 获取项目工时记录
 * GET /api/v1/projects/:id/time-entries?startDate=xxx&endDate=xxx&uid=xxx
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface ProjectTimeEntryRow extends RowDataPacket {
  id: number
  project_id: number
  project_code: string
  project_name: string
  project_short_name: string
  work_item_id: number | null
  item_key: string | null
  title: string | null
  uid: string
  entry_date: string
  hours: number
  description: string | null
  created_at: string
  updated_at: string
}

export default defineEventHandler(async (event) => {
  const authUser = getRequestUid(event)
  if (!authUser) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const projectId = Number(getRouterParam(event, 'id'))
  if (!projectId || isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const query = getQuery(event)
  const startDate = query.startDate as string | undefined
  const endDate = query.endDate as string | undefined
  const uid = query.uid as string | undefined

  const conditions: string[] = ['t.project_id = ?']
  const params: unknown[] = [projectId]

  if (startDate) {
    conditions.push('t.entry_date >= ?')
    params.push(startDate)
  }
  if (endDate) {
    conditions.push('t.entry_date <= ?')
    params.push(endDate)
  }
  if (uid) {
    conditions.push('t.uid = ?')
    params.push(uid)
  }

  const sql = `
    SELECT
      t.id,
      t.project_id,
      p.project_code,
      p.name AS project_name,
      p.short_name AS project_short_name,
      t.work_item_id,
      w.item_key,
      w.title,
      t.uid,
      t.entry_date,
      t.hours,
      t.description,
      t.created_at,
      t.updated_at
    FROM time_entries t
    JOIN aims_projects p ON p.id = t.project_id
    LEFT JOIN work_items w ON t.work_item_id = w.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.entry_date DESC, t.created_at DESC
  `

  const entries = await queryRows<ProjectTimeEntryRow[]>(sql, params)

  return {
    code: 0,
    data: entries.map(e => ({
      id: e.id,
      projectId: e.project_id,
      projectCode: e.project_code,
      projectName: e.project_name,
      projectShortName: e.project_short_name,
      workItemId: e.work_item_id,
      itemKey: e.item_key,
      itemTitle: e.title,
      uid: e.uid,
      entryDate: e.entry_date,
      hours: e.hours,
      description: e.description,
      createdAt: e.created_at,
      updatedAt: e.updated_at
    }))
  }
})
