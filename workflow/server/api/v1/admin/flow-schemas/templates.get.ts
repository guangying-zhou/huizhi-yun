/**
 * GET /api/v1/admin/flow-schemas/templates
 * 获取所有可用的流程模板（用于业务配置时选择）
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { queryRows } from '~~/server/utils/db'

interface TemplateRow extends RowDataPacket {
  id: number
  code: string
  name: string
  description: string | null
  nodes: string
  config: string
}

export default defineEventHandler(async () => {
  try {
    const rows = await queryRows<TemplateRow[]>(
      `SELECT id, code, name, description, nodes, config
       FROM flow_schemas
       WHERE is_template = 1 AND status = 1
       ORDER BY id ASC`
    )

    return {
      code: 0,
      data: rows.map(r => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        nodes: typeof r.nodes === 'string' ? JSON.parse(r.nodes) : r.nodes,
        config: typeof r.config === 'string' ? JSON.parse(r.config) : r.config,
        node_count: (typeof r.nodes === 'string' ? JSON.parse(r.nodes) : r.nodes).length
      }))
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('查询流程模板失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '查询流程模板失败'
    })
  }
})
