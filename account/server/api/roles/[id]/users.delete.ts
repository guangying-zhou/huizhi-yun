import { useDatabase } from '../../../utils/database'
import { logOperationFromEvent } from '../../../utils/log'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const uid = query.uid as string

  if (!id) {
    throw createError({
      statusCode: 400,
      message: '角色ID不能为空'
    })
  }

  if (!uid) {
    throw createError({
      statusCode: 400,
      message: '用户名不能为空'
    })
  }

  try {
    const [roleRows] = await pool.query(
      'SELECT id, role_code FROM roles WHERE id = ?',
      [id]
    ) as [RowDataPacket[], unknown]

    if (roleRows.length === 0) {
      throw createError({
        statusCode: 404,
        message: '角色不存在'
      })
    }

    const role = roleRows[0] as { role_code: string }

    // 删除用户角色关联
    const [result] = await pool.query(
      'DELETE FROM user_roles WHERE role_id = ? AND uid = ?',
      [id, uid]
    ) as [ResultSetHeader, unknown]

    if ((result as ResultSetHeader).affectedRows === 0) {
      throw createError({
        statusCode: 404,
        message: '用户不在该角色中'
      })
    }

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'role.user.remove',
      targetType: 'role',
      targetId: role.role_code,
      detail: {
        roleId: Number(id),
        uid
      }
    })

    return {
      code: 0,
      message: '移除成功'
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('从角色移除用户失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '从角色移除用户失败'
    })
  }
})
