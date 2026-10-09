import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import type { RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['用户信息'],
    summary: '获取用户部门信息',
    description: '获取用户所属部门及其担任负责人/委员会成员的信息。需要 API Key 认证。',
    parameters: [
      { in: 'path', name: 'uid', required: true, schema: { type: 'string' }, description: '用户名（uid）' }
    ]
  }
})

interface DepartmentRow extends RowDataPacket {
  id: number
  name: string
  dept_code: string
  parent_id: number | null
  parent_code: string | null
  level: number
  manager_uid: string | null
  manager_name: string | null
  leader_uid: string | null
  leader_name: string | null
  is_external: number
  description: string | null
  org_type: string | null
  dept_category: number | null
}

interface UserRow extends RowDataPacket {
  dept_code: string | null
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to get user department'
}

export default defineEventHandler(async (event) => {
  // Verify API key
  await verifyApiKey(event)

  const pool = useDbPool()
  const uid = getRouterParam(event, 'uid')

  if (!uid) {
    throw createError({
      statusCode: 400,
      message: 'Uid is required'
    })
  }

  try {
    // Get user's primary department (唯一的非委员会部门)
    const [users] = await pool.query<UserRow[]>(
      `SELECT ud.dept_code 
       FROM system_users u 
       LEFT JOIN user_departments ud ON u.uid = ud.uid
       LEFT JOIN departments d ON ud.dept_code = d.dept_code AND d.org_type = 'department'
       WHERE u.uid = ? AND u.status = 1 AND d.id IS NOT NULL
       LIMIT 1`,
      [uid]
    )

    if (users.length === 0) {
      throw createError({
        statusCode: 404,
        message: 'User not found'
      })
    }

    const user = users[0]
    if (!user) {
      throw createError({
        statusCode: 404,
        message: 'User not found'
      })
    }

    const deptCode = user.dept_code

    // Build department map for lookups
    const [allDepts] = await pool.query<DepartmentRow[]>(
      `SELECT d.id, d.name, d.dept_code, p.dept_code AS parent_code, d.level,
              d.manager_uid, m.real_name AS manager_name,
              d.leader_uid, l.real_name AS leader_name,
              d.org_type, d.dept_category,
              0 AS is_external, d.description
       FROM departments d
       LEFT JOIN departments p ON d.parent_id = p.id
       LEFT JOIN system_users m ON d.manager_uid = m.uid
       LEFT JOIN system_users l ON d.leader_uid = l.uid
       WHERE d.status = 1`
    )

    const deptMap = new Map<string, DepartmentRow>()
    allDepts.forEach(d => deptMap.set(d.dept_code, d))

    // Helper to format department response
    const formatDept = (row: DepartmentRow) => {
      return {
        deptCode: row.dept_code,
        name: row.name,
        parentId: row.parent_code,
        level: row.level,
        orgType: row.org_type || 'department',
        deptCategory: row.dept_category,
        leaderId: row.leader_uid,
        leader: row.leader_name,
        managerId: row.manager_uid,
        manager: row.manager_name,
        isActive: true,
        isExternal: row.is_external === 1,
        description: row.description
      }
    }

    // Get user's department (org_type = 'department')
    let userDept = null
    if (deptCode && deptMap.has(deptCode)) {
      userDept = formatDept(deptMap.get(deptCode)!)
    }

    // Get user's committees (all non-department orgs the user belongs to)
    const [committeeRows] = await pool.query<UserRow[]>(
      `SELECT ud.dept_code FROM user_departments ud
       JOIN departments d ON ud.dept_code = d.dept_code AND d.org_type = 'committee'
       WHERE ud.uid = ?`,
      [uid]
    )
    const committees = committeeRows
      .filter(r => r.dept_code && deptMap.has(r.dept_code))
      .map(r => formatDept(deptMap.get(r.dept_code!)!))

    // Get departments where user is manager
    const managed = allDepts
      .filter(d => d.manager_uid === uid)
      .map(formatDept)

    // Get departments where user is leader
    const led = allDepts
      .filter(d => d.leader_uid === uid)
      .map(formatDept)

    return {
      code: 0,
      data: {
        ...(userDept || {}),
        committees,
        managed,
        led
      }
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error) throw error
    console.error('Failed to get user department:', error)
    throw createError({
      statusCode: 500,
      message: getErrorMessage(error)
    })
  }
})
