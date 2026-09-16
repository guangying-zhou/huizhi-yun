import { useDbPool } from '../../utils/db'
import { logOperationFromEvent } from '../../utils/log'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'

interface UpdateDepartmentBody {
  name?: string
  code?: string
  parentId?: number | null
  managerId?: string | null
  leaderId?: string | null
  isActive?: boolean
  isExternal?: boolean
  orgType?: 'department' | 'committee'
  deptCategory?: 1 | 2 | 3 | 4 | null
}

interface DeptRow extends RowDataPacket {
  id: number
  dept_code: string
  name: string
  org_type: string | null
  dept_category: number | null
}

interface ParentRow extends RowDataPacket {
  id: number
  path: string
  level: number
}

export default defineEventHandler(async (event) => {
  const pool = useDbPool()
  const id = getRouterParam(event, 'id')
  const body = await readBody<UpdateDepartmentBody>(event)
  const validDeptCategories = [1, 2, 3, 4]

  if (!id) {
    throw createError({
      statusCode: 400,
      message: '缺少部门ID'
    })
  }

  try {
    // Check if department exists
    const [existing] = await pool.query<DeptRow[]>(
      'SELECT id, dept_code, name, org_type, dept_category FROM departments WHERE id = ?',
      [id]
    )

    if (existing.length === 0) {
      throw createError({
        statusCode: 404,
        message: '部门不存在'
      })
    }

    // Build update query dynamically
    const updates: string[] = []
    const params: unknown[] = []

    if (body.name !== undefined) {
      updates.push('name = ?')
      params.push(body.name)
    }

    if (body.code !== undefined) {
      updates.push('dept_code = ?')
      params.push(body.code)
    }

    if (body.parentId !== undefined) {
      updates.push('parent_id = ?')
      params.push(body.parentId)

      // Recalculate path and level
      if (body.parentId) {
        const [parents] = await pool.query<ParentRow[]>(
          'SELECT id, path, level FROM departments WHERE id = ?',
          [body.parentId]
        )

        if (parents.length > 0) {
          updates.push('path = ?')
          params.push(`${parents[0]!.path}${parents[0]!.id}/`)
          updates.push('level = ?')
          params.push(parents[0]!.level + 1)
        }
      } else {
        updates.push('path = ?')
        params.push('/')
        updates.push('level = ?')
        params.push(1)
      }
    }

    if (body.managerId !== undefined) {
      updates.push('manager_uid = ?')
      params.push(body.managerId)
    }

    if (body.leaderId !== undefined) {
      updates.push('leader_uid = ?')
      params.push(body.leaderId)
    }

    if (body.isActive !== undefined) {
      updates.push('status = ?')
      params.push(body.isActive ? 1 : 0)
    }

    if (body.isExternal !== undefined) {
      updates.push('description = ?')
      params.push(body.isExternal ? 'external' : null)
    }

    if (body.orgType !== undefined) {
      updates.push('org_type = ?')
      params.push(body.orgType)
    }

    const targetOrgType = body.orgType ?? (existing[0]?.org_type || 'department')
    let nextDeptCategory = body.deptCategory

    if (targetOrgType === 'committee') {
      nextDeptCategory = null
    }

    if (nextDeptCategory !== undefined) {
      if (nextDeptCategory !== null && !validDeptCategories.includes(nextDeptCategory)) {
        throw createError({
          statusCode: 400,
          message: '部门类别必须是 1-行政、2-业务支撑、3-业务、4-核心管理'
        })
      }

      updates.push('dept_category = ?')
      params.push(nextDeptCategory)
    }

    if (updates.length === 0) {
      return {
        code: 0,
        message: '没有需要更新的内容'
      }
    }

    params.push(id)

    await pool.query<ResultSetHeader>(
      `UPDATE departments SET ${updates.join(', ')} WHERE id = ?`,
      params
    )

    // Automatically add manager to user_departments if managerId provided
    if (body.managerId !== undefined && body.managerId && existing[0]) {
      await pool.query('INSERT IGNORE INTO user_departments (uid, dept_code) VALUES (?, ?)', [body.managerId, existing[0].dept_code])
    }

    if (existing[0]) {
      await logOperationFromEvent(event, {
        sourceApp: 'account',
        action: 'department.update',
        targetType: 'department',
        targetId: existing[0].dept_code,
        detail: {
          id: Number(id),
          name: existing[0].name,
          changes: body
        }
      })
    }

    return {
      code: 0,
      message: '更新成功'
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string, code?: string }
    if (error.statusCode) throw error

    console.error('Failed to update department:', error)

    if (error.code === 'ER_DUP_ENTRY') {
      throw createError({
        statusCode: 400,
        message: '部门编码已存在'
      })
    }

    throw createError({
      statusCode: 500,
      message: error.message || '更新部门失败'
    })
  }
})
