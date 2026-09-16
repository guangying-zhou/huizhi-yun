import { useDatabase } from '../../utils/database'
import type { RowDataPacket } from 'mysql2/promise'

interface AppRow extends RowDataPacket {
  id: number
  app_code: string
  app_name: string
  description: string | null
  icon: string | null
  home_url: string | null
  callback_url: string | null
  app_type: string
  sso_type: string | null
  access_scope: string
  status: number
  created_at: string
  updated_at: string
}

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const query = getQuery(event)

  const page = parseInt(query.page as string) || 1
  const pageSize = parseInt(query.pageSize as string) || 20
  const search = query.search as string || ''
  const status = query.status as string
  const app_type = query.app_type as string

  const offset = (page - 1) * pageSize

  try {
    const whereClauses: string[] = []
    const params: unknown[] = []

    if (search) {
      whereClauses.push('(app_code LIKE ? OR app_name LIKE ? OR description LIKE ?)')
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }

    if (status !== undefined && status !== '') {
      whereClauses.push('status = ?')
      params.push(parseInt(status))
    }

    if (app_type) {
      whereClauses.push('app_type = ?')
      params.push(app_type)
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    // 查询总数
    const countSQL = `SELECT COUNT(*) as total FROM applications ${whereSQL}`
    const [countResult] = await pool.query<RowDataPacket[]>(countSQL, params)
    const total = countResult[0]?.total || 0

    // 查询列表
    const listSQL = `
      SELECT id, app_code, app_name, description, icon, home_url, callback_url, app_type, sso_type, access_scope, status, created_at, updated_at
      FROM applications 
      ${whereSQL}
      ORDER BY created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `
    const [rows] = await pool.query<AppRow[]>(listSQL, params)

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
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('获取应用列表失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '获取应用列表失败'
    })
  }
})
