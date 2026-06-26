/**
 * 记录工时
 * POST /api/v1/work-items/:id/time-entries
 * Body: { entryDate: string, hours: number, description?: string }
 */
import type { ResultSetHeader } from '~~/server/utils/db'

interface WorkItemProjectRow {
  id: number
  project_id: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的需求ID' })
  }

  const body = await readBody<{
    entryDate?: string
    hours?: number
    description?: string
  }>(event)

  if (!body.entryDate) {
    throw createError({ statusCode: 400, message: 'entryDate 不能为空' })
  }
  if (!body.hours || body.hours <= 0) {
    throw createError({ statusCode: 400, message: 'hours 必须大于 0' })
  }
  if (body.hours > 24) {
    throw createError({ statusCode: 400, message: 'hours 不能超过 24' })
  }

  // 验证需求存在
  const item = await queryRow<WorkItemProjectRow>(
    'SELECT id, project_id FROM work_items WHERE id = ?',
    [id]
  )
  if (!item) {
    throw createError({ statusCode: 404, message: '需求不存在' })
  }

  const result = await execute<ResultSetHeader>(
    'INSERT INTO time_entries (project_id, work_item_id, uid, entry_date, hours, description) VALUES (?, ?, ?, ?, ?, ?)',
    [item.project_id, id, uid, body.entryDate, body.hours, body.description || null]
  )

  return {
    code: 0,
    data: {
      id: result.insertId,
      projectId: item.project_id,
      workItemId: id,
      uid,
      entryDate: body.entryDate,
      hours: body.hours,
      description: body.description || null
    }
  }
})
