import { useDatabase } from '../../utils/database'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: '日志ID不能为空' })
  }

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
        id,
        user_id,
        uid,
        COALESCE(
          source_app,
          CASE
            WHEN JSON_VALID(detail) THEN JSON_UNQUOTE(JSON_EXTRACT(detail, '$.sourceApp'))
            ELSE NULL
          END
        ) AS source_app,
        COALESCE(
          session_id,
          CASE
            WHEN JSON_VALID(detail) THEN JSON_UNQUOTE(JSON_EXTRACT(detail, '$.sessionId'))
            ELSE NULL
          END
        ) AS session_id,
        action,
        detail,
        ip_address,
        created_at
      FROM operation_logs
      WHERE id = ?`,
      [id]
    )

    if (rows.length === 0) {
      throw createError({ statusCode: 404, message: '日志不存在' })
    }

    return {
      code: 0,
      message: 'success',
      data: rows[0]
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('获取操作日志详情失败:', error)
    throw createError({ statusCode: 500, message: error.message || '获取操作日志详情失败' })
  }
})
