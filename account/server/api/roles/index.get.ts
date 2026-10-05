import { useDatabase } from '../../utils/database'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const query = getQuery(event)

  const page = parseInt(query.page as string) || 1
  const pageSize = parseInt(query.pageSize as string) || 20
  const search = query.search as string || ''
  const status = query.status as string

  const offset = (page - 1) * pageSize

  try {
    // 构建查询条件
    const whereClauses: string[] = []
    const params: unknown[] = []

    if (search) {
      whereClauses.push('(role_code LIKE ? OR role_name LIKE ? OR description LIKE ?)')
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }

    if (status !== undefined && status !== '') {
      whereClauses.push('status = ?')
      params.push(parseInt(status))
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    // 查询总数
    const countSQL = `SELECT COUNT(*) as total FROM roles ${whereSQL}`
    const [countResult] = await pool.query(countSQL, params) as [RowDataPacket[], unknown]
    const total = countResult[0]?.total || 0

    // 查询列表
    const listSQL = `
      SELECT id, role_code, role_name, description, parent_id, is_system, status, created_at, updated_at
      FROM roles 
      ${whereSQL}
      ORDER BY id
      LIMIT ${pageSize} OFFSET ${offset}
    `
    const [rows] = await pool.query(listSQL, params) as [RowDataPacket[], unknown]

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
    console.error('获取角色列表失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '获取角色列表失败'
    })
  }
})
