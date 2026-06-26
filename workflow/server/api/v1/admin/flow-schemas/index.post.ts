/**
 * POST /api/v1/admin/flow-schemas
 * 创建流程定义
 *
 * 支持两种创建方式：
 * 1. 基于模板创建：传 template_id，自动复制模板的 nodes 和 config
 * 2. 自建流程：直接传 nodes 和 config
 *
 * 可通过 is_template=1 创建新模板
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'
import { queryRow, execute } from '~~/server/utils/db'

interface FlowSchemaRow extends RowDataPacket {
  id: number
  nodes: string
  config: string
}

export default defineEventHandler(async (event) => {
  const currentUser = getRequestUid(event)
  if (!currentUser) {
    throw createError({ statusCode: 401, message: '未登录' })
  }

  const body = await readBody(event)
  const { code, name, description, nodes, config, template_id, is_template } = body

  if (!code || !name) {
    throw createError({
      statusCode: 400,
      message: 'code, name 必填'
    })
  }

  try {
    // 检查编码唯一性
    const existing = await queryRow<RowDataPacket>(
      'SELECT id FROM flow_schemas WHERE code = ?',
      [code]
    )
    if (existing) {
      throw createError({ statusCode: 400, message: '流程编码已存在' })
    }

    let finalNodes = nodes
    let finalConfig = config || {}

    // 基于模板创建：从模板复制 nodes 和 config
    if (template_id) {
      const template = await queryRow<FlowSchemaRow>(
        'SELECT id, nodes, config FROM flow_schemas WHERE id = ? AND is_template = 1 AND status = 1',
        [template_id]
      )
      if (!template) {
        throw createError({ statusCode: 404, message: '模板不存在或已禁用' })
      }

      // 模板的 nodes/config 作为基础，允许覆盖
      const templateNodes = typeof template.nodes === 'string' ? JSON.parse(template.nodes) : template.nodes
      const templateConfig = typeof template.config === 'string' ? JSON.parse(template.config) : template.config

      finalNodes = nodes || templateNodes
      finalConfig = config || templateConfig
    }

    if (!finalNodes) {
      throw createError({ statusCode: 400, message: 'nodes 必填（或指定 template_id）' })
    }

    const result = await execute<ResultSetHeader>(
      `INSERT INTO flow_schemas (code, name, description, nodes, config, version, status, is_template, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, NOW(), NOW())`,
      [
        code,
        name,
        description || null,
        JSON.stringify(finalNodes),
        JSON.stringify(finalConfig),
        is_template ? 1 : 0,
        currentUser
      ]
    )

    return {
      code: 0,
      data: {
        id: result.insertId,
        code,
        name,
        is_template: is_template ? 1 : 0,
        from_template: template_id || null
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('创建流程定义失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '创建流程定义失败'
    })
  }
})
