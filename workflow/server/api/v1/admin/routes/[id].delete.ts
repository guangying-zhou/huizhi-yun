/**
 * DELETE /api/v1/admin/routes/:id
 * 软删除路由规则
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'
import { queryRow, execute } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: 'ID 必填' })
  }

  try {
    const existing = await queryRow<RowDataPacket>(
      'SELECT id FROM flow_routes WHERE id = ? AND status = 1',
      [id]
    )
    if (!existing) {
      throw createError({ statusCode: 404, message: '路由规则不存在或已禁用' })
    }

    await execute<ResultSetHeader>(
      'UPDATE flow_routes SET status = 0, updated_at = NOW() WHERE id = ?',
      [id]
    )

    return { code: 0, data: { id: parseInt(id) } }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('删除路由规则失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '删除路由规则失败'
    })
  }
})
