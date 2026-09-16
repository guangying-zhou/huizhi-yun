/**
 * GET /api/v1/departments/accessible?uid=xxx
 * 获取指定用户有权限的部门列表
 *
 * 权限范围：
 * - 用户所在部门（user_departments 表）
 * - 用户作为 manager 的部门
 * - 用户作为 leader（分管领导）的部门
 * - 以上部门的所有下属部门（递归）
 *
 * 排除顶级部门（parent_id IS NULL）
 */
import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import type { RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['部门信息'],
    summary: '获取用户有权部门',
    description: '返回指定用户有权限的部门列表（所在部门、管理/分管部门及其下属部门）。需要 API Key 认证。',
    parameters: [
      { in: 'query', name: 'uid', required: true, schema: { type: 'string' }, description: '用户 UID' }
    ]
  }
})

interface DeptRow extends RowDataPacket {
  id: number
  dept_code: string
  name: string
  parent_id: number | null
  level: number
  org_type: string
  dept_category: number | null
  manager_uid: string | null
  manager_name: string | null
  leader_uid: string | null
  leader_name: string | null
}

interface UserDeptRow extends RowDataPacket {
  dept_code: string
}

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

  const query = getQuery(event)
  const uid = query.uid as string
  if (!uid) {
    throw createError({ statusCode: 400, message: '缺少必填参数 uid' })
  }

  const pool = useDbPool()

  // 1. 获取所有启用部门
  const [allDepts] = await pool.query<DeptRow[]>(
    `SELECT d.id, d.dept_code, d.name, d.parent_id, d.level,
            IFNULL(d.org_type, 'department') AS org_type, d.dept_category,
            d.manager_uid, m.real_name AS manager_name,
            d.leader_uid, l.real_name AS leader_name
     FROM departments d
     LEFT JOIN system_users m ON d.manager_uid = m.uid
     LEFT JOIN system_users l ON d.leader_uid = l.uid
     WHERE d.status = 1
     ORDER BY d.sort_order ASC, d.id ASC`
  )

  // 2. 获取用户所在的所有部门
  const [userDepts] = await pool.query<UserDeptRow[]>(
    'SELECT dept_code FROM user_departments WHERE uid = ?',
    [uid]
  )

  // 构建 id → dept_code 映射（用于解析 parent_id）
  const idToCode = new Map<number, string>()
  for (const d of allDepts) {
    idToCode.set(d.id, d.dept_code)
  }

  // 3. 收集用户直接有权限的部门
  const directCodes = new Set<string>()
  for (const ud of userDepts) {
    directCodes.add(ud.dept_code)
  }
  for (const d of allDepts) {
    if (d.manager_uid === uid || d.leader_uid === uid) {
      directCodes.add(d.dept_code)
    }
  }

  // 4. 递归加入下属部门
  const parentCodeMap = new Map<string, string[]>()
  for (const d of allDepts) {
    if (d.parent_id && idToCode.has(d.parent_id)) {
      const parentCode = idToCode.get(d.parent_id)!
      if (!parentCodeMap.has(parentCode)) parentCodeMap.set(parentCode, [])
      parentCodeMap.get(parentCode)!.push(d.dept_code)
    }
  }

  const allCodes = new Set(directCodes)
  const addChildren = (code: string) => {
    const children = parentCodeMap.get(code)
    if (!children) return
    for (const child of children) {
      if (!allCodes.has(child)) {
        allCodes.add(child)
        addChildren(child)
      }
    }
  }
  for (const code of directCodes) {
    addChildren(code)
  }

  // 5. 过滤：非顶级 + department 类型 + 在权限范围内
  const result = allDepts
    .filter(d => d.org_type === 'department' && d.parent_id != null && allCodes.has(d.dept_code))
    .map(d => ({
      id: d.id,
      deptCode: d.dept_code,
      name: d.name,
      parentId: d.parent_id ? idToCode.get(d.parent_id) || null : null,
      level: d.level,
      orgType: d.org_type,
      deptCategory: d.dept_category,
      managerId: d.manager_uid,
      manager: d.manager_name,
      leaderId: d.leader_uid,
      leader: d.leader_name
    }))

  return {
    code: 0,
    data: result
  }
})
