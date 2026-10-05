import { useDbPool } from '../../utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface DeptRow extends RowDataPacket {
  id: number
  name: string
  code: string
  parentId: number | null
  isActive: number
  isExternal: number
  orgType: string | null
  deptCategory: number | null
  managerId: string | null
  manager: string | null
  leaderId: string | null
  leader: string | null
}

interface MemberRow extends RowDataPacket {
  dept_code: string
  uid: string
  real_name: string | null
}

export default defineEventHandler(async (event) => {
  const pool = useDbPool()

  const query = getQuery(event)
  const search = query.search as string || ''
  const isExternal = query.isExternal as string || 'all'
  const orgType = query.orgType as string || 'all'

  try {
    let sql = `
      SELECT 
        d.id,
        d.name,
        d.dept_code AS code,
        d.parent_id AS parentId,
        d.status = 1 AS isActive,
        COALESCE(d.description LIKE '%external%', 0) AS isExternal,
        d.org_type AS orgType,
        d.dept_category AS deptCategory,
        d.manager_uid AS managerId,
        up_manager.real_name AS manager,
        d.leader_uid AS leaderId,
        up_leader.real_name AS leader
      FROM departments d
      LEFT JOIN system_users up_manager ON d.manager_uid = up_manager.uid
      LEFT JOIN system_users up_leader ON d.leader_uid = up_leader.uid
      WHERE 1=1
    `
    const params: unknown[] = []

    if (search) {
      sql += ' AND (d.name LIKE ? OR d.dept_code LIKE ?)'
      params.push(`%${search}%`, `%${search}%`)
    }

    if (isExternal === '1') {
      sql += ' AND d.description LIKE \'%external%\''
    } else if (isExternal === '0') {
      sql += ' AND (d.description NOT LIKE \'%external%\' OR d.description IS NULL)'
    }

    if (orgType !== 'all') {
      sql += ' AND IFNULL(d.org_type, \'department\') = ?'
      params.push(orgType)
    }

    sql += ' ORDER BY FIELD(IFNULL(d.org_type, \'department\'), \'department\', \'committee\'), d.sort_order ASC, d.id ASC'

    const [rows] = await pool.query<DeptRow[]>(sql, params)

    // Fetch members for ALL departments
    const allDeptCodes = rows.map(r => r.code).filter(Boolean)

    const membersMap = new Map<string, { uid: string, real_name: string }[]>()
    if (allDeptCodes.length > 0) {
      const [memberRows] = await pool.query<MemberRow[]>(
        `SELECT ud.dept_code, ud.uid, su.real_name
         FROM user_departments ud
         LEFT JOIN system_users su ON ud.uid = su.uid
         WHERE ud.dept_code IN (${allDeptCodes.map(() => '?').join(',')})
         ORDER BY CONVERT(su.real_name USING gbk) ASC`,
        allDeptCodes
      )
      for (const row of memberRows) {
        if (!membersMap.has(row.dept_code)) {
          membersMap.set(row.dept_code, [])
        }
        if (row.real_name) {
          membersMap.get(row.dept_code)!.push({ uid: row.uid, real_name: row.real_name })
        }
      }
    }

    // Helper to build tree and get all descendant IDs
    const getChildrenIds = (parentId: number): number[] => {
      const children = rows.filter(r => r.parentId === parentId).map(r => r.id)
      let allChildren = [...children]
      for (const childId of children) {
        allChildren = allChildren.concat(getChildrenIds(childId))
      }
      return allChildren
    }

    const countTotalMembers = (deptId: number): number => {
      const uids = new Set<string>()
      const allRelatedIds = [deptId, ...getChildrenIds(deptId)]

      for (const id of allRelatedIds) {
        const dept = rows.find(r => r.id === id)
        // Only count members if it is a department (not a committee)
        if (dept && (!dept.orgType || dept.orgType === 'department')) {
          const members = membersMap.get(dept.code) || []
          for (const m of members) {
            if (m.uid) uids.add(m.uid)
          }
        }
      }
      return uids.size
    }

    // Transform to match frontend interface
    const departments = rows.map(row => ({
      id: row.id,
      name: row.name,
      code: row.code,
      parentId: row.parentId,
      isActive: Boolean(row.isActive),
      isExternal: Boolean(row.isExternal),
      orgType: row.orgType || 'department',
      deptCategory: row.deptCategory,
      managerId: row.managerId,
      manager: row.manager,
      leaderId: row.leaderId,
      leader: row.leader,
      memberNames: Array.from(
        new Map((membersMap.get(row.code) || []).map(m => [m.uid, m.real_name])).values()
      ),
      totalMembers: countTotalMembers(row.id)
    }))

    return {
      code: 0,
      data: departments
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to get departments:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '获取部门列表失败'
    })
  }
})
