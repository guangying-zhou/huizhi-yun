import { useDatabase } from '../../utils/database'
import { logOperationFromEvent } from '../../utils/log'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  if (!id) {
    throw createError({
      statusCode: 400,
      message: '角色ID不能为空'
    })
  }

  const { role_name, description, parent_id, status } = body

  try {
    // 检查角色是否存在
    const [existing] = await pool.query(
      'SELECT id, is_system, role_code, role_name FROM roles WHERE id = ?',
      [id]
    ) as [RowDataPacket[], unknown]

    if (!existing || existing.length === 0) {
      throw createError({
        statusCode: 404,
        message: '角色不存在'
      })
    }

    const currentRole = existing[0] as { role_code: string, role_name: string }

    // 构建更新字段
    const updates: string[] = []
    const params: unknown[] = []

    if (role_name !== undefined) {
      updates.push('role_name = ?')
      params.push(role_name)
    }
    if (description !== undefined) {
      updates.push('description = ?')
      params.push(description)
    }
    if (parent_id !== undefined) {
      updates.push('parent_id = ?')
      params.push(parent_id)
    }
    if (status !== undefined) {
      updates.push('status = ?')
      params.push(status)
    }

    if (updates.length === 0) {
      return {
        code: 0,
        message: '无需更新',
        data: null
      }
    }

    params.push(id)
    const sql = `UPDATE roles SET ${updates.join(', ')} WHERE id = ?`
    await pool.query(sql, params)

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'role.update',
      targetType: 'role',
      targetId: currentRole.role_code,
      detail: {
        id: Number(id),
        roleName: currentRole.role_name,
        changes: body
      }
    })

    return {
      code: 0,
      message: '更新成功',
      data: { id }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('更新角色失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '更新角色失败'
    })
  }
})
