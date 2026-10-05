/**
 * 获取部门周报列表
 * GET /api/weekly-reports/list?dept_code=xxx&year=2026&viewer=uid
 *
 * 每周只返回一条"当前版本"（不带 V{n} 后缀的工作周报）。
 * 权限过滤：
 * - 部门负责人：可见所有周报（含草稿 readonly_flag=0）
 * - 其他人：仅可见已提交的（readonly_flag=1）
 */

import { getRequestUid } from '~~/server/utils/authIdentity'
import { fetchDirectoryData } from '~~/server/utils/directoryCompat'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import type { DepartmentResponse } from '~/types/account'

interface WeeklyReportRow {
  uuid: string
  title: string
  owner_uid: string
  readonly_flag: number
  created_at: Date | string
  updated_at: Date | string
  content_size: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const deptCode = query.dept_code as string
  const year = parseInt(query.year as string)
  const viewer = (query.viewer as string) || getRequestUid(event)

  if (!deptCode || !year) {
    throw createError({
      statusCode: 400,
      message: '缺少参数: dept_code, year'
    })
  }

  // 判断 viewer 是否是部门负责人
  let isDeptHead = false
  try {
    const deptRes = await fetchDirectoryData<DepartmentResponse>('/departments')
    const dept = deptRes.flat?.find(d => d.deptCode === deptCode)
    if (dept && (dept.managerId === viewer || dept.leaderId === viewer)) {
      isDeptHead = true
    }
  } catch {
    // 无法判断时默认非负责人
  }

  const page = await callCodocsTenantRuntime<{ items?: WeeklyReportRow[] }>(event, '/v1/codocs/documents', {
    query: { type: 'department', dept_code: deptCode, limit: 5000 },
    scope: 'codocs.read'
  })
  const rows = (page.items || [])
    .filter(row => row.title.startsWith(`${year}-W`) && row.title.includes('工作周报') && (isDeptHead || row.readonly_flag === 1))
    .sort((a, b) => b.title.localeCompare(a.title))

  const items: Array<{
    uuid: string
    title: string
    year: number
    week: number
    owner_uid: string
    readonly_flag: number
    hasRevisions: boolean
    created_at: Date | string
    updated_at: Date | string
    content_size: number
  }> = []

  // 收集每周的 Vn 存档信息
  const weekArchives = new Map<number, number>() // week -> max version num

  for (const row of rows) {
    const weekMatch = row.title.match(/(\d{4})-W(\d{2})-/)
    if (!weekMatch) continue

    const weekNum = parseInt(weekMatch[2]!)
    const rowYear = parseInt(weekMatch[1]!)

    // 判断是否是 V{n} 存档
    const vMatch = row.title.match(/V(\d+)$/)
    if (vMatch) {
      // 记录存档信息
      const vNum = parseInt(vMatch[1]!)
      const current = weekArchives.get(weekNum) || 0
      if (vNum > current) weekArchives.set(weekNum, vNum)
      continue // 不放入主列表
    }

    // 当前版本（不带 V 后缀）
    items.push({
      uuid: row.uuid,
      title: row.title,
      year: rowYear,
      week: weekNum,
      owner_uid: row.owner_uid,
      readonly_flag: row.readonly_flag,
      hasRevisions: false,
      created_at: row.created_at,
      updated_at: row.updated_at,
      content_size: row.content_size
    })
  }

  // 标记有修订历史的周
  for (const item of items) {
    if (weekArchives.has(item.week)) {
      item.hasRevisions = true
    }
  }

  return {
    success: true,
    data: {
      items,
      isDeptHead
    }
  }
})
