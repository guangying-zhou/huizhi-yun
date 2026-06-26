/**
 * PATCH /api/v1/admin/form-schemas/:id
 * 更新表单定义
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
      'SELECT id, version FROM form_schemas WHERE id = ?',
      [id]
    )
    if (!existing) {
      throw createError({ statusCode: 404, message: '表单定义不存在' })
    }

    const setClauses: string[] = []
    const params: unknown[] = []

    if (body.name !== undefined) {
      setClauses.push('name = ?')
      params.push(body.name)
    }
    if (body.description !== undefined) {
      setClauses.push('description = ?')
      params.push(body.description)
    }
    if (body.fields !== undefined) {
      setClauses.push('fields = ?')
      params.push(JSON.stringify(body.fields))
    }
    if (body.status !== undefined) {
      setClauses.push('status = ?')
      params.push(body.status)
    }

    if (setClauses.length === 0) {
      throw createError({ statusCode: 400, message: '没有需要更新的字段' })
    }

    setClauses.push('version = version + 1')
    setClauses.push('updated_at = NOW()')
    params.push(id)

    await execute<ResultSetHeader>(
      `UPDATE form_schemas SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    )

    return {
      code: 0,
      data: { id: parseInt(id), version: existing.version + 1 }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('更新表单定义失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '更新表单定义失败'
    })
  }
})
