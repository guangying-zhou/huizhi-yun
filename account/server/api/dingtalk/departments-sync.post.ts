/**
 * 一键同步钉钉部门到本地 departments 表
 * POST /api/dingtalk/departments-sync
 *
 * 逻辑：名称相同→关联，不存在→创建
 */
import { getAllDepartments, isDingtalkConfigured } from '~~/server/utils/dingtalk'
import { queryRows, getConnection } from '~~/server/utils/db'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const uid = getCookie(event, 'auth_user')
  if (!uid) throw createError({ statusCode: 401, message: '请先登录' })

  if (!isDingtalkConfigured()) {
    throw createError({ statusCode: 503, message: '钉钉服务未配置' })
  }

  const dingDepts = await getAllDepartments()

  // 获取本地已有部门
  const localDepts = await queryRows<(RowDataPacket & {
    id: number
    name: string
    dept_code: string
  })[]>('SELECT id, name, dept_code FROM departments WHERE status = 1')

  const localByName = new Map(localDepts.map(d => [d.name, d]))

  const conn = await getConnection()
  await conn.beginTransaction()

  try {
    let created = 0
    let linked = 0
    const skipped = 0

    // 先处理一级部门（parent_id=1），再处理子部门
    // 构建钉钉parent映射
    const dingParentMap = new Map<number, number>() // dept_id → parent_id
    for (const dept of dingDepts) {
      dingParentMap.set(dept.dept_id, dept.parent_id)
    }

    // 按层级排序（parent_id=1 优先）
    const sorted = [...dingDepts].sort((a, b) => {
      const depthA = getDepth(a.dept_id, dingParentMap)
      const depthB = getDepth(b.dept_id, dingParentMap)
      return depthA - depthB
    })

    // 钉钉dept_code → 本地department id 映射
    const dingToLocalId = new Map<number, number>()
    // 根部门(1) → 查找本地根部门
    const localRoot = localDepts.find(d => !d.dept_code || d.dept_code === 'root')
    if (localRoot) {
      dingToLocalId.set(1, localRoot.id)
    }

    for (const dept of sorted) {
      const existing = localByName.get(dept.name)

      if (existing) {
        // 名称匹配 → 关联
        dingToLocalId.set(dept.dept_id, existing.id)
        linked++
      } else {
        // 不存在 → 创建
        const parentLocalId = dingToLocalId.get(dept.parent_id) || null

        const [result] = await conn.execute<ResultSetHeader>(
          `INSERT INTO departments (dept_code, name, parent_id, status, sort_order)
           VALUES (?, ?, ?, 1, 0)`,
          [`ding_${dept.dept_id}`, dept.name, parentLocalId]
        )

        const insertId = result.insertId
        dingToLocalId.set(dept.dept_id, insertId)
        created++
      }
    }

    await conn.commit()

    return {
      code: 0,
      data: {
        total: dingDepts.length,
        created,
        linked,
        skipped
      }
    }
  } catch (err: unknown) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
})

function getDepth(deptCode: number, parentMap: Map<number, number>): number {
  let depth = 0
  let current = deptCode
  while (parentMap.has(current) && current !== 1) {
    depth++
    current = parentMap.get(current)!
  }
  return depth
}
