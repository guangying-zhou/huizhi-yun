/**
 * 获取个人工作周报列表
 * GET /api/personal-weekly-reports/list?owner=xxx&year=2026
 * 返回指定年份的个人周报列表
 */

import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface WeeklyReportRow {
  uuid: string
  title: string
  owner_uid: string
  created_at: Date | string
  updated_at: Date | string
  content_size: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const owner = query.owner as string
  const year = parseInt(query.year as string)

  if (!owner || !year) {
    throw createError({
      statusCode: 400,
      message: '缺少参数: owner, year'
    })
  }

  const pattern = new RegExp(`^${year}-W\\d{2}-.*工作周报$`)

  const page = await callCodocsTenantRuntime<{ items?: WeeklyReportRow[] }>(event, '/v1/codocs/documents', {
    query: { owner, limit: 5000 },
    scope: 'codocs.read'
  })
  const rows = (page.items || [])
    .filter(row => pattern.test(row.title))
    .sort((a, b) => b.title.localeCompare(a.title))

  // 从 title 中提取周数
  const items = rows.map((row) => {
    const weekMatch = row.title.match(/(\d{4})-W(\d{2})-/)
    return {
      uuid: row.uuid,
      title: row.title,
      year: weekMatch ? parseInt(weekMatch[1]!) : year,
      week: weekMatch ? parseInt(weekMatch[2]!) : 0,
      owner_uid: row.owner_uid,
      created_at: row.created_at,
      updated_at: row.updated_at,
      content_size: row.content_size
    }
  })

  return { success: true, data: { items } }
})
