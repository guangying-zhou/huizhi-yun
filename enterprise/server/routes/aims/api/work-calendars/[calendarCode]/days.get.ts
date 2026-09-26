import { createError, defineEventHandler, getQuery, getRouterParam, setHeader } from 'h3'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { getConsoleWorkCalendarDays } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'

// 保留独立应用的 URL（/api/work-calendars/:code/days），复用原页面就不改契约。
// 数据源本来就是 Console 工作日历，这里改用 Foundation 的 Console runtime helper，
// 不再另开跨应用服务令牌。
const calendarCode = /^[A-Za-z0-9_-]{1,32}$/
const yearMonth = /^\d{4}-\d{2}$/

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  await requireEnterpriseUser(event)
  const code = String(getRouterParam(event, 'calendarCode') || '').trim()
  if (!calendarCode.test(code)) throw createError({ statusCode: 400, message: '日历标识无效' })
  const raw = getQuery(event)
  const query: Record<string, string> = {}
  const month = String(raw.yearMonth || '').trim()
  if (month) {
    if (!yearMonth.test(month)) throw createError({ statusCode: 400, message: '月份参数无效' })
    query.yearMonth = month
  }
  const result = await getConsoleWorkCalendarDays(event, code, query)
  return { code: 0, data: { items: result?.data || [] } }
})
