/**
 * 删除工时记录
 * DELETE /api/v1/work-items/:id/time-entries/:entryId
 *
 * 仅录入人本人可以删除自己的工时记录
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
    throw createError({ statusCode: 403, message: '只能删除自己的工时记录' })
  }

  await execute<ResultSetHeader>('DELETE FROM time_entries WHERE id = ?', [entryId])

  return { code: 0, data: { id: entryId } }
})
