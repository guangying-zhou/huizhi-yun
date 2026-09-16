import { useDatabase } from '../../utils/database'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const query = getQuery(event)

  const page = parseInt(query.page as string) || 1
  const pageSize = parseInt(query.pageSize as string) || 20
  const uid = query.uid as string
  const target_app = query.target_app as string
  const session_id = query.session_id as string
  const login_result = query.login_result as string
  const login_type = query.login_type as string
  const start_date = query.start_date as string
  const end_date = query.end_date as string

  const offset = (page - 1) * pageSize

  try {
    const whereClauses: string[] = []
    const params: (string | number)[] = []

    if (uid) {
      whereClauses.push('(l.uid LIKE ? OR u.real_name LIKE ?)')
      params.push(`%${uid}%`, `%${uid}%`)
    }

    if (target_app) {
      whereClauses.push('l.target_app = ?')
      params.push(target_app)
    }

    if (session_id) {
      whereClauses.push('l.session_id = ?')
      params.push(session_id)
    }

    if (login_result !== undefined && login_result !== '') {
      whereClauses.push('l.login_result = ?')
      params.push(parseInt(login_result))
    }

    if (login_type) {
      whereClauses.push('l.login_type = ?')
      params.push(login_type)
    }

    if (start_date) {
      whereClauses.push('l.created_at >= ?')
      params.push(start_date)
    }

    if (end_date) {
      whereClauses.push('l.created_at <= ?')
      params.push(end_date + ' 23:59:59')
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    // 查询总数
    const countSQL = `
      SELECT COUNT(*) as total
      FROM login_logs l
      LEFT JOIN system_users u ON u.uid = l.uid
      ${whereSQL}
    `
    const [countResult] = await pool.query<RowDataPacket[]>(countSQL, params)
    const total = countResult[0]?.total || 0

    // 查询列表
    const listSQL = `
      SELECT l.id, l.uid, l.login_type, l.login_result, l.failure_reason,
        l.target_app, l.session_id, l.ip_address, l.location, l.device, l.browser, l.os, l.created_at,
        u.real_name
      FROM login_logs l
      LEFT JOIN system_users u ON u.uid = l.uid
      ${whereSQL}
      ORDER BY l.created_at DESC
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
    console.error('获取登录日志失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '获取登录日志失败'
    })
  }
})
