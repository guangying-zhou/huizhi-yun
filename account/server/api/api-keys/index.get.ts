import { useDbPool } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface ApiKeyRow extends RowDataPacket {
  id: number
  key_name: string
  api_key: string
  scopes: string | null
  rate_limit: number
  ip_whitelist: string | null
  expires_at: string | null
  status: number
  last_used_at: string | null
  created_at: string
  updated_at: string
}

export default defineEventHandler(async (event) => {
  const pool = useDbPool()
  const query = getQuery(event)

  const page = parseInt(query.page as string) || 1
  const pageSize = parseInt(query.pageSize as string) || 20
  const search = (query.search as string) || ''
  const status = query.status as string

  try {
    let sql = `
      SELECT 
        id, key_name, api_key, scopes, rate_limit, 
        ip_whitelist, expires_at, status, last_used_at, created_at, updated_at
      FROM api_keys
      WHERE 1=1
    `
    const params: (string | number)[] = []

    if (search) {
      sql += ' AND (key_name LIKE ? OR api_key LIKE ?)'
      params.push(`%${search}%`, `%${search}%`)
    }

    if (status !== undefined && status !== 'all') {
      sql += ' AND status = ?'
      params.push(parseInt(status))
    }

    // Count total
    const countSql = sql.replace(/SELECT[\s\S]+FROM/, 'SELECT COUNT(*) as total FROM')
    const [countRows] = await pool.query<RowDataPacket[]>(countSql, params)
    const total = countRows[0]?.total || 0

    // Add pagination
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    const limitParams = [...params, pageSize, (page - 1) * pageSize]

    const [rows] = await pool.query<ApiKeyRow[]>(sql, limitParams)

    // Mask api_key for security (show only first 8 chars)
    const items = rows.map(row => ({
      id: row.id,
      keyName: row.key_name,
      apiKey: row.api_key.substring(0, 8) + '...',
      apiKeyFull: row.api_key,
      scopes: row.scopes ? JSON.parse(row.scopes) : [],
      rateLimit: row.rate_limit,
      ipWhitelist: row.ip_whitelist ? JSON.parse(row.ip_whitelist) : [],
      expiresAt: row.expires_at,
      status: row.status,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))

    return {
      code: 0,
      data: {
        items,
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to get API keys:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '获取API密钥列表失败'
    })
  }
})
