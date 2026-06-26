/**
 * DELETE /api/v1/admin/action-defs/:id
 * 软删除资源动作定义
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
      'SELECT id FROM flow_action_defs WHERE id = ? AND status = 1',
      [id]
    )
    if (!existing) {
      throw createError({ statusCode: 404, message: '动作定义不存在或已禁用' })
    }

    await execute<ResultSetHeader>(
      'UPDATE flow_action_defs SET status = 0, updated_at = NOW() WHERE id = ?',
      [id]
    )

    return { code: 0, data: { id: parseInt(id) } }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('删除动作定义失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '删除动作定义失败'
    })
  }
})
