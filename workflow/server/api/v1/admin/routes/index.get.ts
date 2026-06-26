/**
 * GET /api/v1/admin/routes?action_def_id=xxx
 * 路由规则列表
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { queryRows, queryRow } from '~~/server/utils/db'

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const actionDefId = query.action_def_id as string
  const page = parseInt(query.page as string) || 1
  const pageSize = parseInt(query.page_size as string) || 50
  const offset = (page - 1) * pageSize

  try {
    const whereClauses: string[] = []
    const params: unknown[] = []

    if (actionDefId) {
      whereClauses.push('r.action_def_id = ?')
      params.push(actionDefId)
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    const countRow = await queryRow<CountRow>(
      `SELECT COUNT(*) as total FROM flow_routes r ${whereSQL}`,
      params
    )
    const total = countRow?.total || 0

    const rows = await queryRows<RowDataPacket[]>(
      `SELECT r.*, f.code as flow_code, f.name as flow_name
       FROM flow_routes r
       LEFT JOIN flow_schemas f ON r.flow_schema_id = f.id
       ${whereSQL}
       ORDER BY r.priority DESC, r.id ASC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    )

    return {
      code: 0,
      data: {
        items: rows.map(r => ({
          id: r.id,
          action_def_id: r.action_def_id,
          flow_schema_id: r.flow_schema_id,
          flow_schema: { id: r.flow_schema_id, code: r.flow_code, name: r.flow_name },
          name: r.name,
          description: r.description,
          level: r.level ?? null,
          conditions: typeof r.conditions === 'string' ? JSON.parse(r.conditions) : r.conditions,
          priority: r.priority,
          is_default: r.is_default,
          status: r.status,
          created_by: r.created_by,
          created_at: r.created_at,
          updated_at: r.updated_at
        })),
        total,
        page,
        page_size: pageSize
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('查询路由规则失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '查询路由规则失败'
    })
  }
})
