import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import type { RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['用户信息'],
    summary: '获取用户列表',
    description: '获取启用状态的普通用户列表，同时返回按部门组织的树形结构。需要 API Key 认证。',
    parameters: [
      { in: 'query', name: 'search', schema: { type: 'string' }, description: '关键字搜索（uid/姓名/邮箱）' },
      { in: 'query', name: 'dept_code', schema: { type: 'string' }, description: '按部门编码筛选' }
    ]
  }
})

interface UserRow extends RowDataPacket {
  id: number
  uid: string
  real_name: string | null
  nickname: string | null
  email: string | null
  avatar: string | null
  mobile: string | null
  dept_code: string | null
  dept_name: string | null
}

interface DeptNode {
  deptCode: string
  name: string
  parentId?: string | null
  children: DeptNode[]
  users: UserItem[]
}

interface UserItem {
  uid: string
  realName: string | null
  nickname: string | null
  email: string | null
  mobile: string | null
  avatar: string | null
  deptCode: string | null
  deptName: string | null
}

export default defineEventHandler(async (event) => {
  // Verify API key
  await verifyApiKey(event)

  const pool = useDbPool()
  const query = getQuery(event) as Record<string, string | undefined>

  const search = (query.search as string) || ''
  const deptCode = query.dept_code as string

  try {
    // 1. Fetch filtered users
    let sql = ''
    const params: (string | number)[] = []

    if (deptCode) {
      sql = `
        SELECT u.id, u.uid, u.real_name, u.nickname, u.email, u.avatar, u.mobile, d.dept_code, d.name AS dept_name
        FROM system_users u
        INNER JOIN user_departments ud ON u.uid = ud.uid
        INNER JOIN departments d ON ud.dept_code = d.dept_code AND d.org_type = 'department'
        WHERE u.user_type = 1 AND u.status = 1 AND d.dept_code = ?
      `
      params.push(deptCode)
    } else {
      sql = `
        SELECT u.id, u.uid, u.real_name, u.nickname, u.email, u.avatar, u.mobile, ud.primary_dept_code AS dept_code, d.name AS dept_name
        FROM system_users u
        LEFT JOIN (
          SELECT ud.uid, MIN(ud.dept_code) AS primary_dept_code
          FROM user_departments ud
          INNER JOIN departments d ON ud.dept_code = d.dept_code AND d.org_type = 'department'
          GROUP BY ud.uid
        ) ud ON u.uid = ud.uid
        LEFT JOIN departments d ON ud.primary_dept_code = d.dept_code AND d.org_type = 'department'
        WHERE u.user_type = 1 AND u.status = 1
      `
    }

    if (search) {
      sql += ' AND (u.uid LIKE ? OR u.real_name LIKE ? OR u.email LIKE ?)'
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }

    // Order by uid
    sql += ' ORDER BY u.uid ASC'

    // Execute query (no pagination)
    const [userRows] = await pool.query<UserRow[]>(sql, params)

    // 2. Fetch all active departments for tree
    const [deptRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, dept_code, parent_id, level, status, leader_uid, manager_uid
       FROM departments
       WHERE status = 1
       ORDER BY sort_order ASC, id ASC`
    )

    // Build department map
    const deptMap = new Map<string, DeptNode>()
    const deptRowsMap = new Map<number, RowDataPacket>()
    const roots: DeptNode[] = []

    // Initialize department nodes
    deptRows.forEach((row: RowDataPacket) => {
      deptRowsMap.set(row.id, row)
      const node: DeptNode = {
        deptCode: row.dept_code,
        name: row.name,
        // parentId will be resolved to string code
        children: [],
        users: [] // Initialize users array
      }
      deptMap.set(row.dept_code, node)
    })

    // 3. Build Tree & Populate Users

    // Link departments
    deptRows.forEach((row: RowDataPacket) => {
      const dept = deptMap.get(row.dept_code)
      if (!dept) return

      // Resolve parentId
      if (row.parent_id && deptRowsMap.has(row.parent_id)) {
        const parentDeptCode = (deptRowsMap.get(row.parent_id) as RowDataPacket).dept_code
        dept.parentId = parentDeptCode
        const parentDept = deptMap.get(parentDeptCode)
        if (parentDept) {
          parentDept.children.push(dept)
        }
      } else {
        dept.parentId = null
        roots.push(dept)
      }
    })

    // Populate users into tree
    const userItems = userRows.map((u) => {
      const userObj: UserItem = {
        uid: u.uid,
        realName: u.real_name,
        nickname: u.nickname,
        email: u.email,
        mobile: u.mobile,
        avatar: normalizeAvatarOutput(u.avatar),
        deptCode: u.dept_code,
        deptName: u.dept_name
      }

      // Add to department tree if user has a department
      if (u.dept_code) {
        const dept = deptMap.get(u.dept_code)
        if (dept) {
          dept.users.push(userObj)
        }
      }

      return userObj
    })

    // 将部门经理（manager_uid）加入对应部门的 users 列表，并置顶
    const userItemMap = new Map<string, UserItem>()
    for (const u of userItems) {
      userItemMap.set(u.uid, u)
    }
    deptRows.forEach((row: RowDataPacket) => {
      const dept = deptMap.get(row.dept_code)
      if (!dept || !row.manager_uid) return
      const managerUid = row.manager_uid as string
      const existingIndex = dept.users.findIndex(u => u.uid === managerUid)
      if (existingIndex > 0) {
        // 已在列表中但不在第一位，移到第一位
        const [manager] = dept.users.splice(existingIndex, 1)
        if (manager) dept.users.unshift(manager)
      } else if (existingIndex === -1) {
        // 不在列表中，从全量用户中查找并插入第一位
        const user = userItemMap.get(managerUid)
        if (user) {
          dept.users.unshift(user)
        }
      }
      // existingIndex === 0 时已在第一位，无需操作
    })

    return {
      code: 0,
      data: {
        items: userItems,
        tree: roots,
        total: userItems.length
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to get users:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to get users'
    })
  }
})
