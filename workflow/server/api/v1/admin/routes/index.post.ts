/**
 * POST /api/v1/admin/routes
 * 创建路由规则
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'
import { queryRow, execute } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const currentUser = getRequestUid(event)
  if (!currentUser) {
    throw createError({ statusCode: 401, message: '未登录' })
  }

  const body = await readBody(event)
  const { action_def_id, flow_schema_id, name, description, level, conditions, priority, is_default } = body

  if (!action_def_id || !flow_schema_id || !name) {
    throw createError({
      statusCode: 400,
      message: 'action_def_id, flow_schema_id, name 必填'
    })
  }

  try {
    // 验证动作定义存在
    const actionDef = await queryRow<RowDataPacket>(
      'SELECT id FROM flow_action_defs WHERE id = ?',
      [action_def_id]
    )
    if (!actionDef) {
      throw createError({ statusCode: 400, message: '动作定义不存在' })
    }

    // 验证流程定义存在
    const flowSchema = await queryRow<RowDataPacket>(
      'SELECT id FROM flow_schemas WHERE id = ?',
      [flow_schema_id]
    )
    if (!flowSchema) {
      throw createError({ statusCode: 400, message: '流程定义不存在' })
    }

    const result = await execute<ResultSetHeader>(
      `INSERT INTO flow_routes
       (action_def_id, flow_schema_id, name, description, level, conditions, priority, is_default, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW())`,
      [
        action_def_id,
        flow_schema_id,
        name,
        description || null,
        level !== undefined && level !== null ? Number(level) : null,
        JSON.stringify(conditions || {}),
        priority || 0,
        is_default ? 1 : 0,
        currentUser
      ]
    )

    return {
      code: 0,
      data: {
        id: result.insertId,
        name
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('创建路由规则失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '创建路由规则失败'
    })
  }
})
