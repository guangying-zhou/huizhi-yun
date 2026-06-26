/**
 * GET /api/v1/admin/form-schemas
 * 表单定义列表（分页）
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { queryRows, queryRow } from '~~/server/utils/db'

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const page = parseInt(query.page as string) || 1
  const pageSize = parseInt(query.page_size as string) || 20
  const search = query.search as string || ''
  const status = query.status as string
  const offset = (page - 1) * pageSize

  try {
    const whereClauses: string[] = []
    const params: unknown[] = []

    if (search) {
      whereClauses.push('(code LIKE ? OR name LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }

    if (status !== undefined && status !== '') {
      whereClauses.push('status = ?')
      params.push(parseInt(status))
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    const countRow = await queryRow<CountRow>(
      `SELECT COUNT(*) as total FROM form_schemas ${whereSQL}`,
      params
    )
    const total = countRow?.total || 0

    const rows = await queryRows<RowDataPacket[]>(
      `SELECT id, code, name, description, version, status, created_by, created_at, updated_at
       FROM form_schemas ${whereSQL}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    )

    return {
      code: 0,
      data: {
        items: rows,
        total,
        page,
        page_size: pageSize
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('查询表单定义失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '查询表单定义失败'
    })
  }
})
