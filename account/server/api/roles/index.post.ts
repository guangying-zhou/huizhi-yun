import { useDatabase } from '../../utils/database'
import { logOperationFromEvent } from '../../utils/log'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const body = await readBody(event)

  const { role_code, role_name, description, parent_id, status = 1 } = body

  if (!role_code || !role_name) {
    throw createError({
      statusCode: 400,
      message: '角色编码和角色名称不能为空'
    })
  }

  try {
    // 检查角色编码是否已存在
    const [existing] = await pool.query(
      'SELECT id FROM roles WHERE role_code = ?',
      [role_code]
    ) as [RowDataPacket[], unknown]

    if (existing.length > 0) {
      throw createError({
        statusCode: 400,
        message: '角色编码已存在'
      })
    }

    // 创建角色
    const [result] = await pool.query(
      `INSERT INTO roles (role_code, role_name, description, parent_id, is_system, status)
       VALUES (?, ?, ?, ?, 0, ?)`,
      [role_code, role_name, description || null, parent_id || null, status]
    ) as [ResultSetHeader, unknown]

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'role.create',
      targetType: 'role',
      targetId: role_code,
      detail: {
        id: result.insertId,
        roleCode: role_code,
        roleName: role_name,
        parentId: parent_id || null,
        status
      }
    })

    return {
      code: 0,
      message: '创建成功',
      data: {
        id: result.insertId,
        role_code,
        role_name,
        description,
        status
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('创建角色失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '创建角色失败'
    })
  }
})
