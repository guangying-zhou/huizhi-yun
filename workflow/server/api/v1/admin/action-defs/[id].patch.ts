/**
 * PATCH /api/v1/admin/action-defs/:id
 * 更新资源动作定义
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'
import { queryRow, execute } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: 'ID 必填' })
  }

  const body = await readBody(event)

  try {
    const existing = await queryRow<RowDataPacket>(
      'SELECT id FROM flow_action_defs WHERE id = ?',
      [id]
    )
    if (!existing) {
      throw createError({ statusCode: 404, message: '动作定义不存在' })
    }

    const setClauses: string[] = []
    const params: unknown[] = []

    // 编码字段变更时校验唯一性
    const newAppCode = body.app_code !== undefined ? body.app_code : undefined
    const newResourceCode = body.resource_code !== undefined ? body.resource_code : undefined
    const newActionCode = body.action_code !== undefined ? body.action_code : undefined

    if (newAppCode !== undefined || newResourceCode !== undefined || newActionCode !== undefined) {
      // 获取当前值用于组合校验
      const current = await queryRow<RowDataPacket>(
        'SELECT app_code, resource_code, action_code FROM flow_action_defs WHERE id = ?',
        [id]
      )
      const checkApp = newAppCode ?? current?.app_code
      const checkResource = newResourceCode ?? current?.resource_code
      const checkAction = newActionCode ?? current?.action_code

      const dup = await queryRow<RowDataPacket>(
        'SELECT id FROM flow_action_defs WHERE app_code = ? AND resource_code = ? AND action_code = ? AND id != ?',
        [checkApp, checkResource, checkAction, id]
      )
      if (dup) {
        throw createError({ statusCode: 400, message: '该应用资源下的动作编码已存在' })
      }

      if (newAppCode !== undefined) {
        setClauses.push('app_code = ?')
        params.push(newAppCode)
      }
      if (newResourceCode !== undefined) {
        setClauses.push('resource_code = ?')
        params.push(newResourceCode)
      }
      if (newActionCode !== undefined) {
        setClauses.push('action_code = ?')
        params.push(newActionCode)
      }
    }

    if (body.name !== undefined) {
      setClauses.push('name = ?')
      params.push(body.name)
    }
    if (body.description !== undefined) {
      setClauses.push('description = ?')
      params.push(body.description)
    }
    if (body.form_schema_id !== undefined) {
      setClauses.push('form_schema_id = ?')
      params.push(body.form_schema_id)
    }
    if (body.icon !== undefined) {
      setClauses.push('icon = ?')
      params.push(body.icon)
    }
    if (body.sort_order !== undefined) {
      setClauses.push('sort_order = ?')
      params.push(body.sort_order)
    }
    if (body.status !== undefined) {
      setClauses.push('status = ?')
      params.push(body.status)
    }

    if (setClauses.length === 0) {
      throw createError({ statusCode: 400, message: '没有需要更新的字段' })
    }

    setClauses.push('updated_at = NOW()')
    params.push(id)

    await execute<ResultSetHeader>(
      `UPDATE flow_action_defs SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    )

    return { code: 0, data: { id: parseInt(id) } }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('更新动作定义失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '更新动作定义失败'
    })
  }
})
