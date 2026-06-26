/**
 * PATCH /api/v1/admin/routes/:id
 * 更新路由规则
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
      'SELECT id FROM flow_routes WHERE id = ?',
      [id]
    )
    if (!existing) {
      throw createError({ statusCode: 404, message: '路由规则不存在' })
    }

    const setClauses: string[] = []
    const params: unknown[] = []

    if (body.flow_schema_id !== undefined) {
      setClauses.push('flow_schema_id = ?')
      params.push(body.flow_schema_id)
    }
    if (body.name !== undefined) {
      setClauses.push('name = ?')
      params.push(body.name)
    }
    if (body.description !== undefined) {
      setClauses.push('description = ?')
      params.push(body.description)
    }
    if (body.level !== undefined) {
      setClauses.push('level = ?')
      params.push(body.level !== null ? Number(body.level) : null)
    }
    if (body.conditions !== undefined) {
      setClauses.push('conditions = ?')
      params.push(JSON.stringify(body.conditions))
    }
    if (body.priority !== undefined) {
      setClauses.push('priority = ?')
      params.push(body.priority)
    }
    if (body.is_default !== undefined) {
      setClauses.push('is_default = ?')
      params.push(body.is_default ? 1 : 0)
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
      `UPDATE flow_routes SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    )

    return { code: 0, data: { id: parseInt(id) } }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('更新路由规则失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '更新路由规则失败'
    })
  }
})
