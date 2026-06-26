/**
 * GET /api/v1/admin/flow-schemas
 * 流程定义列表（分页）
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { queryRows, queryRow } from '~~/server/utils/db'

interface FlowSchemaRow extends RowDataPacket {
  id: number
  code: string
  name: string
  description: string | null
  version: number
  status: number
  is_template: number
  created_by: string
  created_at: string
  updated_at: string
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const page = parseInt(query.page as string) || 1
  const pageSize = parseInt(query.page_size as string) || 20
  const search = query.search as string || ''
  const status = query.status as string
  const isTemplate = query.is_template as string
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

    if (isTemplate !== undefined && isTemplate !== '') {
      whereClauses.push('is_template = ?')
      params.push(parseInt(isTemplate))
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    const countRow = await queryRow<CountRow>(
      `SELECT COUNT(*) as total FROM flow_schemas ${whereSQL}`,
      params
    )
    const total = countRow?.total || 0

    const rows = await queryRows<FlowSchemaRow[]>(
      `SELECT id, code, name, description, version, status, is_template, created_by, created_at, updated_at
       FROM flow_schemas ${whereSQL}
       ORDER BY is_template DESC, id DESC
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
    console.error('查询流程定义失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '查询流程定义失败'
    })
  }
})
