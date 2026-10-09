import { queryRows, execute } from '../../utils/db'
import type { RowDataPacket } from 'mysql2/promise'
import { logOperationFromEvent } from '../../utils/log'

interface DepartmentRow extends RowDataPacket {
  id: number
  name: string
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: '缺少部门ID'
    })
  }

  try {
    // Check if department exists
    const existing = await queryRows<DepartmentRow[]>(
      'SELECT id, name FROM departments WHERE id = ?',
      [id]
    )

    if (existing.length === 0) {
      throw createError({
        statusCode: 404,
        message: '部门不存在'
      })
    }

    const currentDepartment = existing[0]
    if (!currentDepartment) {
      throw createError({
        statusCode: 404,
        message: '部门不存在'
      })
    }

    // Check if department has children
    const children = await queryRows<RowDataPacket[]>(
      'SELECT id FROM departments WHERE parent_id = ?',
      [id]
    )

    if (children.length > 0) {
      throw createError({
        statusCode: 400,
        message: '该部门下有子部门，无法删除'
      })
    }

    // Check if department has users
    const users = await queryRows<RowDataPacket[]>(
      'SELECT id FROM system_users WHERE dept_code = ?',
      [id]
    )

    if (users.length > 0) {
      throw createError({
        statusCode: 400,
        message: '该部门下有用户，无法删除'
      })
    }

    // Delete department
    await execute('DELETE FROM departments WHERE id = ?', [id])

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'department.delete',
      targetType: 'department',
      targetId: currentDepartment.id,
      detail: {
        id: currentDepartment.id,
        name: currentDepartment.name
      }
    })

    return {
      code: 0,
      message: '删除成功'
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error

    console.error('Failed to delete department:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '删除部门失败'
    })
  }
})
