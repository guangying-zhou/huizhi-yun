/**
 * 删除交付物
 * DELETE /api/v1/deliverables/:id
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface DeliverableRow extends RowDataPacket {
  id: number
  status: string
  required: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的交付物ID' })
  }

  const rows = await queryRows<DeliverableRow[]>(
    'SELECT id, status, `required` FROM deliverables WHERE id = ?',
    [id]
  )

  if (rows.length === 0) {
    throw createError({ statusCode: 404, message: '交付物不存在' })
  }

  if (rows[0]!.required) {
    throw createError({ statusCode: 400, message: '系统必选交付物不允许删除' })
  }

  if (rows[0]!.status !== 'pending') {
    throw createError({ statusCode: 400, message: '只能删除待准备状态的交付物' })
  }

  await execute('DELETE FROM deliverables WHERE id = ?', [id])

  return { code: 0, data: null }
})
