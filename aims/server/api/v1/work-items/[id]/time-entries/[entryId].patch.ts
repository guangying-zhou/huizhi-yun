/**
 * 修改工时记录
 * PATCH /api/v1/work-items/:id/time-entries/:entryId
 * Body: { entryDate?: string, hours?: number, description?: string | null }
 *
 * 仅录入人本人可以修改自己的工时记录
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'

interface EntryRow extends RowDataPacket {
  id: number
  work_item_id: number
  uid: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const workItemId = Number(getRouterParam(event, 'id'))
  const entryId = Number(getRouterParam(event, 'entryId'))
  if (!workItemId || Number.isNaN(workItemId) || !entryId || Number.isNaN(entryId)) {
    throw createError({ statusCode: 400, message: '无效的参数' })
  }

  const entry = await queryRow<EntryRow>(
    'SELECT id, work_item_id, uid FROM time_entries WHERE id = ?',
    [entryId]
  )
  if (!entry) {
    throw createError({ statusCode: 404, message: '工时记录不存在' })
  }
  if (entry.work_item_id !== workItemId) {
    throw createError({ statusCode: 400, message: '记录与工作项不匹配' })
  }
  if (entry.uid !== uid) {
    throw createError({ statusCode: 403, message: '只能修改自己的工时记录' })
  }

  const body = await readBody<{
    entryDate?: string
    hours?: number
    description?: string | null
  }>(event)

  const sets: string[] = []
  const params: unknown[] = []

  if (body.entryDate !== undefined) {
    if (!body.entryDate) throw createError({ statusCode: 400, message: 'entryDate 不能为空' })
    sets.push('entry_date = ?')
    params.push(body.entryDate)
  }
  if (body.hours !== undefined) {
    const h = Number(body.hours)
    if (!Number.isFinite(h) || h <= 0) throw createError({ statusCode: 400, message: 'hours 必须大于 0' })
    if (h > 24) throw createError({ statusCode: 400, message: 'hours 不能超过 24' })
    sets.push('hours = ?')
    params.push(h)
  }
  if (body.description !== undefined) {
    sets.push('description = ?')
    params.push(body.description || null)
  }

  if (sets.length === 0) {
    return { code: 0, data: { id: entryId } }
  }

  params.push(entryId)
  await execute<ResultSetHeader>(
    `UPDATE time_entries SET ${sets.join(', ')} WHERE id = ?`,
    params
  )

  return { code: 0, data: { id: entryId } }
})
