/**
 * AI 用量统计接口
 * GET /api/v1/ai/usage
 */
import type { RowDataPacket } from 'mysql2/promise'
import { verifyApiKey } from '~~/server/utils/api-auth'
import { isAiEnabled } from '~~/server/utils/ai'
import { queryRows } from '~~/server/utils/db'

defineRouteMeta({
  openAPI: {
    tags: ['AI 服务'],
    summary: 'AI 用量统计',
    description: '获取指定应用的 AI 调用用量统计，需要 account:ai 的 view 权限。需要 API Key 认证。',
    parameters: [
      { in: 'query', name: 'app_code', schema: { type: 'string' }, description: '应用编码，不填则查询全部' },
      { in: 'query', name: 'start_date', schema: { type: 'string', format: 'date' }, description: '起始日期 YYYY-MM-DD' },
      { in: 'query', name: 'end_date', schema: { type: 'string', format: 'date' }, description: '结束日期 YYYY-MM-DD' }
    ]
  }
})

interface SummaryRow extends RowDataPacket {
  total_calls: number
  total_tokens: number
  prompt_tokens: number
  completion_tokens: number
  success_count: number
  avg_latency_ms: number
}

interface AppUsageRow extends RowDataPacket {
  app_code: string
  calls: number
  total_tokens: number
}

interface ActionUsageRow extends RowDataPacket {
  action: string
  calls: number
  total_tokens: number
}

interface DailyUsageRow extends RowDataPacket {
  date: string
  calls: number
  total_tokens: number
}

interface QuotaRow extends RowDataPacket {
  app_code: string
  daily_limit: number
  monthly_limit: number
  daily_used: number
  monthly_used: number
}

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

  if (!isAiEnabled()) {
    throw createError({ statusCode: 403, message: 'AI 服务未启用' })
  }

  const query = getQuery(event)
  const appCode = query.app_code as string | undefined

  // 日期范围默认为当月
  // 数据库 timezone='Z' 存储 UTC 时间，查询日期也用 UTC 保持一致
  const now = new Date()
  const utcYear = now.getUTCFullYear()
  const utcMonth = String(now.getUTCMonth() + 1).padStart(2, '0')
  const utcDay = String(now.getUTCDate()).padStart(2, '0')
  const defaultStart = `${utcYear}-${utcMonth}-01`
  const defaultEnd = `${utcYear}-${utcMonth}-${utcDay}`
  const startDate = (query.start_date as string) || defaultStart
  const endDate = (query.end_date as string) || defaultEnd

  const appFilter = appCode ? 'AND app_code = ?' : ''
  const params = appCode ? [startDate, endDate, appCode] : [startDate, endDate]

  // 汇总统计
  const summary = await queryRows<SummaryRow[]>(
    `SELECT
       COUNT(*) as total_calls,
       COALESCE(SUM(total_tokens), 0) as total_tokens,
       COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
       COALESCE(SUM(completion_tokens), 0) as completion_tokens,
       SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
       COALESCE(AVG(latency_ms), 0) as avg_latency_ms
     FROM ai_usage_logs
     WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) ${appFilter}`,
    params
  )

  // 按应用汇总
  const byApp = await queryRows<AppUsageRow[]>(
    `SELECT app_code, COUNT(*) as calls, COALESCE(SUM(total_tokens), 0) as total_tokens
     FROM ai_usage_logs
     WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) ${appFilter}
     GROUP BY app_code ORDER BY calls DESC`,
    params
  )

  // 按场景汇总
  const byAction = await queryRows<ActionUsageRow[]>(
    `SELECT action, COUNT(*) as calls, COALESCE(SUM(total_tokens), 0) as total_tokens
     FROM ai_usage_logs
     WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) ${appFilter}
     GROUP BY action ORDER BY calls DESC`,
    params
  )

  // 按日汇总
  const daily = await queryRows<DailyUsageRow[]>(
    `SELECT DATE(created_at) as date, COUNT(*) as calls, COALESCE(SUM(total_tokens), 0) as total_tokens
     FROM ai_usage_logs
     WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) ${appFilter}
     GROUP BY DATE(created_at) ORDER BY date ASC`,
    params
  )

  // 配额使用情况
  const quotaQuery = appCode
    ? `SELECT q.app_code, q.daily_limit, q.monthly_limit,
         (SELECT COUNT(*) FROM ai_usage_logs WHERE app_code = q.app_code AND DATE(created_at) = UTC_DATE()) as daily_used,
         (SELECT COUNT(*) FROM ai_usage_logs WHERE app_code = q.app_code AND YEAR(created_at) = YEAR(UTC_DATE()) AND MONTH(created_at) = MONTH(UTC_DATE())) as monthly_used
       FROM ai_quotas q WHERE q.app_code = ? AND q.status = 1`
    : `SELECT q.app_code, q.daily_limit, q.monthly_limit,
         (SELECT COUNT(*) FROM ai_usage_logs WHERE app_code = q.app_code AND DATE(created_at) = UTC_DATE()) as daily_used,
         (SELECT COUNT(*) FROM ai_usage_logs WHERE app_code = q.app_code AND YEAR(created_at) = YEAR(UTC_DATE()) AND MONTH(created_at) = MONTH(UTC_DATE())) as monthly_used
       FROM ai_quotas q WHERE q.status = 1`
  const quotaParams = appCode ? [appCode] : []
  const quotas = await queryRows<QuotaRow[]>(quotaQuery, quotaParams)

  const s = summary[0]
  const totalCalls = s?.total_calls || 0
  const successCount = s?.success_count || 0

  return {
    code: 0,
    data: {
      period: { startDate, endDate },
      summary: {
        totalCalls,
        totalTokens: Number(s?.total_tokens || 0),
        promptTokens: Number(s?.prompt_tokens || 0),
        completionTokens: Number(s?.completion_tokens || 0),
        successRate: totalCalls > 0 ? Math.round(successCount / totalCalls * 1000) / 10 : 100,
        avgLatencyMs: Math.round(Number(s?.avg_latency_ms || 0))
      },
      byApp: byApp.map(row => ({
        appCode: row.app_code,
        calls: Number(row.calls),
        totalTokens: Number(row.total_tokens),
        quota: quotas.find(q => q.app_code === row.app_code)
          ? {
              dailyLimit: quotas.find(q => q.app_code === row.app_code)!.daily_limit,
              monthlyLimit: quotas.find(q => q.app_code === row.app_code)!.monthly_limit,
              dailyUsed: quotas.find(q => q.app_code === row.app_code)!.daily_used,
              monthlyUsed: quotas.find(q => q.app_code === row.app_code)!.monthly_used
            }
          : null
      })),
      byAction: byAction.map(row => ({
        action: row.action,
        calls: Number(row.calls),
        totalTokens: Number(row.total_tokens)
      })),
      daily: daily.map(row => ({
        date: row.date,
        calls: Number(row.calls),
        totalTokens: Number(row.total_tokens)
      }))
    }
  }
})
