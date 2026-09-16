import { useDatabase } from '../../utils/database'
import { logOperationFromEvent } from '../../utils/log'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: '角色ID不能为空'
    })
  }

  try {
    // 检查角色是否存在
    const [existing] = await pool.query(
      'SELECT id, is_system, role_code FROM roles WHERE id = ?',
      [id]
    ) as [RowDataPacket[], unknown]

    if (!existing || existing.length === 0) {
      throw createError({
        statusCode: 404,
        message: '角色不存在'
      })
    }

    const role = existing[0] as { is_system: number, role_code: string }

    // 系统内置角色不能删除
    if (role.is_system === 1) {
      throw createError({
        statusCode: 400,
        message: '系统内置角色不能删除'
      })
    }

    // 检查是否有用户关联此角色
    const [userRoles] = await pool.query(
      'SELECT COUNT(*) as count FROM user_roles WHERE role_id = ?',
      [id]
    ) as [RowDataPacket[], unknown]

    const usersInRole = (userRoles[0] as { count: number }).count
    if (usersInRole > 0) {
      throw createError({
        statusCode: 400,
        message: `该角色下还有 ${usersInRole} 个用户，请先移除用户后再删除`
      })
    }

    // 删除角色权限关联
    await pool.query('DELETE FROM role_permissions WHERE role_id = ?', [id])

    // 删除角色
    await pool.query('DELETE FROM roles WHERE id = ?', [id])

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'role.delete',
      targetType: 'role',
      targetId: role.role_code,
      detail: {
        id: Number(id),
        roleCode: role.role_code
      }
    })

    return {
      code: 0,
      message: '删除成功',
      data: null
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('删除角色失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '删除角色失败'
    })
  }
})
