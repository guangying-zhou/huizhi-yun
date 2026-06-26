/**
 * PATCH /api/v1/admin/flow-schemas/:id
 * 更新流程定义（版本号递增）
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'
import { queryRow, execute } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const currentUser = getRequestUid(event)
  if (!currentUser) {
    throw createError({ statusCode: 401, message: '未登录' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: 'ID 必填' })
  }

  const body = await readBody(event)

  try {
    const existing = await queryRow<RowDataPacket>(
      'SELECT id, version FROM flow_schemas WHERE id = ?',
      [id]
    )
    if (!existing) {
      throw createError({ statusCode: 404, message: '流程定义不存在' })
    }

    const setClauses: string[] = []
    const params: unknown[] = []

    if (body.code !== undefined) {
      // 校验编码唯一性（排除自身）
      const dup = await queryRow<RowDataPacket>(
        'SELECT id FROM flow_schemas WHERE code = ? AND id != ?',
        [body.code, id]
      )
      if (dup) {
        throw createError({ statusCode: 400, message: '流程编码已存在' })
      }
      setClauses.push('code = ?')
      params.push(body.code)
    }
    if (body.name !== undefined) {
      setClauses.push('name = ?')
      params.push(body.name)
    }
    if (body.description !== undefined) {
      setClauses.push('description = ?')
      params.push(body.description)
    }
    if (body.nodes !== undefined) {
      setClauses.push('nodes = ?')
      params.push(JSON.stringify(body.nodes))
    }
    if (body.config !== undefined) {
      setClauses.push('config = ?')
      params.push(JSON.stringify(body.config))
    }
    if (body.status !== undefined) {
      setClauses.push('status = ?')
      params.push(body.status)
    }

    if (setClauses.length === 0) {
      throw createError({ statusCode: 400, message: '没有需要更新的字段' })
    }

    // 版本号递增
    setClauses.push('version = version + 1')
    setClauses.push('updated_at = NOW()')

    params.push(id)

    await execute<ResultSetHeader>(
      `UPDATE flow_schemas SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    )

    return {
      code: 0,
      data: { id: parseInt(id), version: existing.version + 1 }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('更新流程定义失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '更新流程定义失败'
    })
  }
})
