import { useDatabase } from '../../utils/database'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const query = getQuery(event)

  const page = parseInt(query.page as string) || 1
  const pageSize = parseInt(query.pageSize as string) || 20
  const uid = query.uid as string
  const sourceApp = query.source_app as string
  const sessionId = query.session_id as string
  const action = query.action as string
  const startDate = query.start_date as string
  const endDate = query.end_date as string

  const offset = (page - 1) * pageSize

  try {
    const whereClauses: string[] = []
    const params: (string | number)[] = []

    if (uid) {
      whereClauses.push('uid LIKE ?')
      params.push(`%${uid}%`)
    }

    if (sourceApp) {
      whereClauses.push(`(
        source_app = ?
        OR (
          source_app IS NULL
          AND JSON_VALID(detail)
          AND JSON_UNQUOTE(JSON_EXTRACT(detail, '$.sourceApp')) = ?
        )
      )`)
      params.push(sourceApp, sourceApp)
    }

    if (sessionId) {
      whereClauses.push(`(
        session_id = ?
        OR (
          session_id IS NULL
          AND JSON_VALID(detail)
          AND JSON_UNQUOTE(JSON_EXTRACT(detail, '$.sessionId')) = ?
        )
      )`)
      params.push(sessionId, sessionId)
    }

    if (action) {
      whereClauses.push('action = ?')
      params.push(action)
    }

    if (startDate) {
      whereClauses.push('created_at >= ?')
      params.push(startDate)
    }

    if (endDate) {
      whereClauses.push('created_at <= ?')
      params.push(`${endDate} 23:59:59`)
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    const countSQL = `SELECT COUNT(*) as total FROM operation_logs ${whereSQL}`
    const [countResult] = await pool.query<RowDataPacket[]>(countSQL, params)
    const total = countResult[0]?.total || 0

    const listSQL = `
      SELECT
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
      ${whereSQL}
      ORDER BY created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `
    const [rows] = await pool.query<RowDataPacket[]>(listSQL, params)

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
    console.error('获取操作日志失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '获取操作日志失败'
    })
  }
})
