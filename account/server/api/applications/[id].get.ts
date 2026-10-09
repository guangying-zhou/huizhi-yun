import { useDatabase } from '../../utils/database'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: '应用ID不能为空'
    })
  }

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, app_code, app_name, description, icon, home_url, callback_url, logout_url, app_type, sso_type, access_scope, status, created_at, updated_at
       FROM applications WHERE id = ?`,
      [id]
    )

    if (rows.length === 0) {
      throw createError({
        statusCode: 404,
        message: '应用不存在'
      })
    }

    return {
      code: 0,
      message: 'success',
      data: rows[0]
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('获取应用详情失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '获取应用详情失败'
    })
  }
})
