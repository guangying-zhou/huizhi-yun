/**
 * 获取钉钉组织架构
 * GET /api/dingtalk/departments
 */
import { getAllDepartments, isDingtalkConfigured } from '~~/server/utils/dingtalk'
import { queryRows } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface LocalDeptRow extends RowDataPacket {
  id: number
  name: string
  dept_code: string
}

interface DingTalkDeptUI {
  dept_id: number
  name: string
  parent_id: number
  dept_code: string | number
  children: DingTalkDeptUI[]
  is_linked: boolean
}

export default defineEventHandler(async (event) => {
  const uid = getCookie(event, 'auth_user')
  if (!uid) throw createError({ statusCode: 401, message: '请先登录' })

  if (!isDingtalkConfigured()) {
    throw createError({ statusCode: 503, message: '钉钉服务未配置' })
  }

  const departments = await getAllDepartments()

  // 查本地已有的部门，用于判断是否已关联
  const localDepts = await queryRows<LocalDeptRow[]>(
    'SELECT id, name, dept_code FROM departments WHERE status = 1'
  )

  let allLinked = true
  const dingDeptItems: DingTalkDeptUI[] = departments.map((dept) => {
    const isLinked = localDepts.some(l => l.name === dept.name || l.dept_code === `ding_${dept.dept_id}` || l.dept_code === String(dept.dept_id))
    if (!isLinked) allLinked = false
    return {
      ...dept,
      dept_code: dept.dept_id,
      children: [],
      is_linked: isLinked
    }
  })

  // 构建树形结构
  const deptMap = new Map<number, DingTalkDeptUI>()
  const roots: DingTalkDeptUI[] = []

  // 先加入根部门
  const rootDept: DingTalkDeptUI = {
    dept_id: 1,
    dept_code: 1,
    name: '根部门',
    parent_id: 0,
    children: [],
    is_linked: true
  }
  deptMap.set(1, rootDept)

  for (const dept of dingDeptItems) {
    deptMap.set(dept.dept_id, dept)
  }

  for (const dept of dingDeptItems) {
    const parent = deptMap.get(dept.parent_id)
    if (parent) {
      parent.children.push(dept)
    } else {
      roots.push(dept)
    }
  }

  // 根部门的 children 就是一级部门
  const rootNode = deptMap.get(1)

  return {
    code: 0,
    data: {
      tree: rootNode ? [rootNode] : roots,
      flat: dingDeptItems,
      total: departments.length,
      allLinked
    }
  }
})
