/**
 * 获取某周周报的历史存档版本
 * GET /api/weekly-reports/versions?dept_code=xxx&year=2026&week=12
 *
 * 返回 V1, V2... 存档版本（均为只读）
 */

import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface VersionRow {
  uuid: string
  title: string
  readonly_flag: number
  created_at: Date | string
  updated_at: Date | string
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const deptCode = query.dept_code as string
  const year = parseInt(query.year as string)
  const week = parseInt(query.week as string)

  if (!deptCode || !year || !week) {
    throw createError({ statusCode: 400, message: '缺少参数: dept_code, year, week' })
  }

  const weekStr = String(week).padStart(2, '0')
  const page = await callCodocsTenantRuntime<{ items?: VersionRow[] }>(event, '/v1/codocs/documents', {
    query: { type: 'department', dept_code: deptCode, limit: 5000 },
    scope: 'codocs.read'
  })
  const rows = (page.items || []).filter(row => row.title.startsWith(`${year}-W${weekStr}-`) && /工作周报V\d+$/.test(row.title))

  const versions = rows.map((row) => {
    const vMatch = row.title.match(/V(\d+)$/)
    return {
      uuid: row.uuid,
      title: row.title,
      versionNum: vMatch ? parseInt(vMatch[1]!) : 0,
      readonly_flag: row.readonly_flag,
      created_at: row.created_at,
      updated_at: row.updated_at
    }
  }).sort((a, b) => b.versionNum - a.versionNum)

  return { success: true, data: { versions } }
})
