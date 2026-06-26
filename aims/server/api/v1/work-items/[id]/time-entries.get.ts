/**
 * 获取需求的工时记录
 * GET /api/v1/work-items/:id/time-entries
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface TimeEntryRow extends RowDataPacket {
  id: number
  work_item_id: number
  uid: string
  entry_date: string
  hours: number
  description: string | null
  created_at: string
  updated_at: string
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

  const entries = await queryRows<TimeEntryRow[]>(
    'SELECT * FROM time_entries WHERE work_item_id = ? ORDER BY entry_date ASC, created_at ASC',
    [id]
  )

  return {
    code: 0,
    data: entries.map(e => ({
      id: e.id,
      workItemId: e.work_item_id,
      uid: e.uid,
      entryDate: e.entry_date,
      hours: e.hours,
      description: e.description,
      createdAt: e.created_at,
      updatedAt: e.updated_at
    }))
  }
})
