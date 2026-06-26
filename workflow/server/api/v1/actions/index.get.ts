/**
 * GET /api/v1/actions?resource_code=xxx
 * 查询资源可用动作
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { queryRows } from '~~/server/utils/db'

interface ActionDefRow extends RowDataPacket {
  id: number
  resource_code: string
  action_code: string
  name: string
  description: string | null
  form_schema_id: number | null
  icon: string | null
  sort_order: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const appCode = query.app_code as string
  const resourceCode = query.resource_code as string

  if (!appCode || !resourceCode) {
    throw createError({
      statusCode: 400,
      message: 'app_code 和 resource_code 参数必填'
    })
  }

  try {
    const rows = await queryRows<ActionDefRow[]>(
      `SELECT a.id, a.app_code, a.resource_code, a.action_code, a.name, a.description, a.icon, a.form_schema_id, a.sort_order,
              f.code as form_code, f.name as form_name
       FROM flow_action_defs a
       LEFT JOIN form_schemas f ON a.form_schema_id = f.id
       WHERE a.app_code = ? AND a.resource_code = ? AND a.status = 1
       ORDER BY a.sort_order ASC, a.id ASC`,
      [appCode, resourceCode]
    )

    return {
      code: 0,
      data: rows.map((r) => {
        const extra = r as ActionDefRow & { form_code?: string, form_name?: string }
        return {
          id: r.id,
          resource_code: r.resource_code,
          action_code: r.action_code,
          name: r.name,
          description: r.description,
          icon: r.icon,
          form_schema: r.form_schema_id
            ? {
                id: r.form_schema_id,
                code: extra.form_code,
                name: extra.form_name
              }
            : null
        }
      })
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
