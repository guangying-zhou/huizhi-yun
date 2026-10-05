/**
 * 获取用户工作日志列表
 * GET /api/worklogs/list?owner=xxx&year=2026&month=3
 * 返回指定月份有日志的日期列表及文档信息
 */

import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface WorklogListRow {
  uuid: string
  title: string
  created_at: Date | string
  updated_at: Date | string
  content_size: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const owner = query.owner as string
  const year = parseInt(query.year as string)
  const month = parseInt(query.month as string)

  if (!owner || !year || !month) {
    throw createError({
      statusCode: 400,
      message: '缺少参数: owner, year, month'
    })
  }

  const monthStr = String(month).padStart(2, '0')
  const newPrefix = `${year}${monthStr}`
  const oldPrefix = `工作日志_${year}${monthStr}`

  const page = await callCodocsTenantRuntime<{ items?: WorklogListRow[] }>(event, '/v1/codocs/documents', {
    query: { owner, limit: 5000 },
    scope: 'codocs.read'
  })
  const rows = (page.items || [])
    .filter(row => (row.title.startsWith(newPrefix) && row.title.includes('工作日志')) || row.title.startsWith(oldPrefix))
    .sort((a, b) => a.title.localeCompare(b.title))

  // 从 title 中提取日期（兼容新旧格式）
  const items = rows.map((row) => {
    // 新格式: YYYYMMDD-XXX工作日志
    const newMatch = row.title.match(/^(\d{4})(\d{2})(\d{2})-/)
    // 旧格式: 工作日志_YYYYMMDD
    const oldMatch = row.title.match(/工作日志_(\d{4})(\d{2})(\d{2})/)
    const dateMatch = newMatch || oldMatch
    return {
      uuid: row.uuid,
      title: row.title,
      date: dateMatch
        ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
        : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      content_size: row.content_size
    }
  })

  return { success: true, data: { items } }
})
