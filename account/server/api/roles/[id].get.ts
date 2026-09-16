import { useDatabase } from '../../utils/database'
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
    // 获取角色基本信息
    const [roles] = await pool.query(
      `SELECT id, role_code, role_name, description, parent_id, is_system, status, created_at, updated_at
       FROM roles WHERE id = ?`,
      [id]
    ) as [RowDataPacket[], unknown]

    if (roles.length === 0) {
      throw createError({
        statusCode: 404,
        message: '角色不存在'
      })
    }

    const role = roles[0]

    // 获取角色权限
    const [permissions] = await pool.query(
      `SELECT p.id, p.perm_code, p.perm_name, p.perm_type, p.module
       FROM permissions p
       INNER JOIN role_permissions rp ON p.id = rp.permission_id
       WHERE rp.role_id = ?`,
      [id]
    ) as [RowDataPacket[], unknown]

    // 获取角色下用户数量
    const [userCount] = await pool.query(
      'SELECT COUNT(*) as count FROM user_roles WHERE role_id = ?',
      [id]
    ) as [RowDataPacket[], unknown]

    return {
      code: 0,
      message: 'success',
      data: {
        ...role,
        permissions,
        user_count: (userCount[0] as { count: number }).count
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('获取角色详情失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '获取角色详情失败'
    })
  }
})
