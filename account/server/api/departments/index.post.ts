import { useDbPool } from '../../utils/db'
import { logOperationFromEvent } from '../../utils/log'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'

interface CreateDepartmentBody {
  name: string
  code?: string
  parentId?: number | null
  managerId?: string | null
  leaderId?: string | null
  isActive?: boolean
  isExternal?: boolean
  orgType?: 'department' | 'committee'
  deptCategory?: 1 | 2 | 3 | 4 | null
}

interface ParentRow extends RowDataPacket {
  id: number
  path: string
  level: number
}

export default defineEventHandler(async (event) => {
  const pool = useDbPool()
  const body = await readBody<CreateDepartmentBody>(event)
  const validDeptCategories = [1, 2, 3, 4]

  if (!body.name) {
    throw createError({
      statusCode: 400,
      message: '部门名称不能为空'
    })
  }

  try {
    // Generate dept_code if not provided
    const deptCode = body.code || `dept_${Date.now()}`

    // Calculate path based on parent
    let path = '/'
    let level = 1

    if (body.parentId) {
      const [parents] = await pool.query<ParentRow[]>(
        'SELECT id, path, level FROM departments WHERE id = ?',
        [body.parentId]
      )

      if (parents.length > 0) {
        path = `${parents[0]!.path}${parents[0]!.id}/`
        level = parents[0]!.level + 1
      }
    }

    // Build description for isExternal flag (simple approach)
    const description = body.isExternal ? 'external' : null
    const orgType = body.orgType || 'department'
    const deptCategory = orgType === 'committee' ? null : (body.deptCategory ?? null)

    if (deptCategory !== null && !validDeptCategories.includes(deptCategory)) {
      throw createError({
        statusCode: 400,
        message: '部门类别必须是 1-行政、2-业务支撑、3-业务、4-核心管理'
      })
    }

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO departments (dept_code, name, parent_id, path, level, status, description, manager_uid, leader_uid, org_type, dept_category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        deptCode,
        body.name,
        body.parentId || null,
        path,
        level,
        body.isActive !== false ? 1 : 0,
        description,
        body.managerId || null,
        body.leaderId || null,
        orgType,
        deptCategory
      ]
    )

    // Automatically add manager to user_departments
    if (body.managerId) {
      await pool.query('INSERT IGNORE INTO user_departments (uid, dept_code) VALUES (?, ?)', [body.managerId, deptCode])
    }

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'department.create',
      targetType: 'department',
      targetId: deptCode,
      detail: {
        id: result.insertId,
        name: body.name,
        parentId: body.parentId || null,
        managerId: body.managerId || null,
        leaderId: body.leaderId || null,
        orgType,
        deptCategory
      }
    })

    return {
      code: 0,
      message: '创建成功',
      data: {
        id: result.insertId
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string, code?: string }
    if (error.statusCode) throw error
    console.error('Failed to create department:', error)

    if (error.code === 'ER_DUP_ENTRY') {
      throw createError({
        statusCode: 400,
        message: '部门编码已存在'
      })
    }

    throw createError({
      statusCode: 500,
      message: error.message || '创建部门失败'
    })
  }
})
