import { useDatabase } from '../../../utils/database'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)

  const page = Math.max(1, parseInt(query.page as string) || 1)
  const pageSize = Math.min(5000, Math.max(1, parseInt(query.pageSize as string) || 1000))

  if (!id) {
    throw createError({
      statusCode: 400,
      message: '角色ID不能为空'
    })
  }

  const offset = (page - 1) * pageSize

  try {
    // 查询总数
    const [countResult] = await pool.query(
      'SELECT COUNT(*) as total FROM user_roles WHERE role_id = ?',
      [id]
    ) as [RowDataPacket[], unknown]
    const total = (countResult[0] as { total: number }).total

    // 查询用户列表
    const [rows] = await pool.query(
      `SELECT 
        ur.uid,
        up.real_name,
        up.nickname,
        usc.email,
        usc.status,
        ur.created_at as assigned_at
      FROM user_roles ur
      LEFT JOIN system_users up ON ur.uid = up.uid
      LEFT JOIN user_status_cache usc ON ur.uid = usc.ldap_uid
      WHERE ur.role_id = ?
      ORDER BY ur.created_at DESC
      LIMIT ? OFFSET ?`,
      [id, pageSize, offset]
    ) as [RowDataPacket[], unknown]

    return {
      code: 0,
      message: 'success',
      data: {
        items: rows,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      }
    }
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('获取角色用户失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '获取角色用户失败'
    })
  }
})
