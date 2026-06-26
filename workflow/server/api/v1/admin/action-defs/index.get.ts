/**
 * GET /api/v1/admin/action-defs
 * 资源动作定义列表
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
  const resourceCode = query.resource_code as string
  const search = query.search as string || ''
  const offset = (page - 1) * pageSize

  try {
    const whereClauses: string[] = []
    const params: unknown[] = []

    if (resourceCode) {
      whereClauses.push('a.resource_code = ?')
      params.push(resourceCode)
    }

    if (search) {
      whereClauses.push('(a.action_code LIKE ? OR a.name LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    const countRow = await queryRow<CountRow>(
      `SELECT COUNT(*) as total FROM flow_action_defs a ${whereSQL}`,
      params
    )
    const total = countRow?.total || 0

    const rows = await queryRows<RowDataPacket[]>(
      `SELECT a.*, f.code as form_code, f.name as form_name,
              fs.name as flow_schema_name
       FROM flow_action_defs a
       LEFT JOIN form_schemas f ON a.form_schema_id = f.id
       LEFT JOIN flow_routes fr ON fr.action_def_id = a.id AND fr.is_default = 1 AND fr.status = 1
       LEFT JOIN flow_schemas fs ON fr.flow_schema_id = fs.id
       ${whereSQL}
       ORDER BY a.app_code ASC, a.resource_code ASC, a.sort_order ASC, a.id ASC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    )

    return {
      code: 0,
      data: {
        items: rows.map(r => ({
          id: r.id,
          app_code: r.app_code,
          resource_code: r.resource_code,
          action_code: r.action_code,
          name: r.name,
          description: r.description,
          form_schema_id: r.form_schema_id,
          form_schema: r.form_schema_id ? { id: r.form_schema_id, code: r.form_code, name: r.form_name } : null,
          flow_schema_name: r.flow_schema_name || null,
          embed_url_pattern: r.embed_url_pattern,
          icon: r.icon,
          sort_order: r.sort_order,
          source: r.source || 'manual',
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
    console.error('查询动作定义失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '查询动作定义失败'
    })
  }
})
