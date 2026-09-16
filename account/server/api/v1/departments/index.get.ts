import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import type { RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['部门信息'],
    summary: '获取部门列表',
    description: '获取所有启用部门，同时返回树形结构和扁平列表。需要 API Key 认证。'
  }
})

interface DepartmentRow extends RowDataPacket {
  id: number
  name: string
  dept_code: string
  parent_id: number | null
  level: number
  status: number
  manager_uid: string | null
  manager_name: string | null
  leader_uid: string | null
  leader_name: string | null
  is_external: number
  description: string | null
  org_type: string
  dept_category: number | null
}

interface DeptNode {
  deptCode: string
  name: string
  parentId: string | null
  level: number
  orgType: string
  deptCategory: number | null
  managerId: string | null
  manager: string | null
  leaderId: string | null
  leader: string | null
  children: DeptNode[]
}

export default defineEventHandler(async (event) => {
  // Verify API key
  await verifyApiKey(event)

  const pool = useDbPool()

  try {
    const [rows] = await pool.query<DepartmentRow[]>(
      `SELECT d.id, d.name, d.dept_code, d.parent_id, d.level, d.status,
              d.manager_uid, m.real_name AS manager_name,
              d.leader_uid, l.real_name AS leader_name,
              IFNULL(d.org_type, 'department') AS org_type,
              d.dept_category,
              0 AS is_external, d.description
       FROM departments d
       LEFT JOIN system_users m ON d.manager_uid = m.uid
       LEFT JOIN system_users l ON d.leader_uid = l.uid
       WHERE d.status = 1
       ORDER BY d.sort_order ASC, d.id ASC`
    )

    // Build map for easy access
    const deptRowsMap = new Map<number, DepartmentRow>()
    rows.forEach(row => deptRowsMap.set(row.id, row))

    // Build tree structure
    const deptMap = new Map<number, DeptNode>()
    const roots: DeptNode[] = []

    // First pass: create all nodes
    rows.forEach((row) => {
      // Find parent dept_code string if parent exists
      let parentIdStr = null
      if (row.parent_id && deptRowsMap.has(row.parent_id)) {
        parentIdStr = deptRowsMap.get(row.parent_id)!.dept_code
      } else if (row.parent_id) {
        // Parent exists but is not in the filtered list (e.g. status=0),
        // so strictly this node shouldn't be here or should be orphan?
        // For now, treat as root or decide based on requirements.
        // Given WHERE status=1, if parent is disabled, child remains but becomes root?
        // Assuming integrity relative to status=1 filter.
        parentIdStr = null
      }

      deptMap.set(row.id, {
        deptCode: row.dept_code,
        name: row.name,
        parentId: parentIdStr,
        level: row.level,
        orgType: row.org_type || 'department',
        deptCategory: row.dept_category,
        managerId: row.manager_uid,
        manager: row.manager_name,
        leaderId: row.leader_uid,
        leader: row.leader_name,
        children: []
      })
    })

    // Second pass: build tree
    rows.forEach((row) => {
      const dept = deptMap.get(row.id)
      if (!dept) return

      if (row.parent_id && deptMap.has(row.parent_id)) {
        deptMap.get(row.parent_id)!.children.push(dept)
      } else {
        roots.push(dept)
      }
    })

    return {
      code: 0,
      data: {
        tree: roots,
        flat: rows.map((row) => {
          let parentIdStr = null
          if (row.parent_id && deptRowsMap.has(row.parent_id)) {
            parentIdStr = deptRowsMap.get(row.parent_id)!.dept_code
          }
          return {
            id: row.id,
            deptCode: row.dept_code,
            name: row.name,
            parentId: parentIdStr,
            level: row.level,
            orgType: row.org_type || 'department',
            deptCategory: row.dept_category,
            managerId: row.manager_uid,
            manager: row.manager_name,
            leaderId: row.leader_uid,
            leader: row.leader_name
          }
        })
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to get departments:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to get departments'
    })
  }
})
