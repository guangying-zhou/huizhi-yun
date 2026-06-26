/**
 * POST /api/v1/admin/action-defs
 * 创建资源动作定义
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'
import { queryRow, execute } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const currentUser = getRequestUid(event)
  if (!currentUser) {
    throw createError({ statusCode: 401, message: '未登录' })
  }

  const body = await readBody(event)
  const { app_code, resource_code, action_code, name, description, form_schema_id, icon, sort_order } = body

  if (!app_code || !resource_code || !action_code || !name) {
    throw createError({
      statusCode: 400,
      message: 'app_code, resource_code, action_code, name 必填'
    })
  }

  try {
    // 检查唯一约束
    const existing = await queryRow<RowDataPacket>(
      'SELECT id FROM flow_action_defs WHERE app_code = ? AND resource_code = ? AND action_code = ?',
      [app_code, resource_code, action_code]
    )
    if (existing) {
      throw createError({ statusCode: 400, message: '该应用资源下的动作编码已存在' })
    }

    const result = await execute<ResultSetHeader>(
      `INSERT INTO flow_action_defs
       (app_code, resource_code, action_code, name, description, form_schema_id, icon, sort_order, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW())`,
      [
        app_code,
        resource_code,
        action_code,
        name,
        description || null,
        form_schema_id || null,
        icon || null,
        sort_order || 0,
        currentUser
      ]
    )

    return {
      code: 0,
      data: {
        id: result.insertId,
        resource_code,
        action_code,
        name
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('创建动作定义失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '创建动作定义失败'
    })
  }
})
