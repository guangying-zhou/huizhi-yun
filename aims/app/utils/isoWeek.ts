// ISO 8601 周（周一至周日）的纯日历计算。
//
// 与 Runtime `isoWeekRange`（data-runtime/internal/apps/aims/project_weekly_reports.go）
// 一致：以 1 月 4 日所在周为第 1 周，按 UTC 日历推算日期，不受浏览器时区影响。
// weekly_reporting_periods 再把同一日历日期放到租户配置时区的 00:00，
// 因此展示的起止日期与服务端周期一致。

export interface IsoWeek {
  year: number
  week: number
}

const DAY_MS = 86_400_000

function isoWeekStartUtc(year: number, week: number) {
  const jan4 = Date.UTC(year, 0, 4)
  const weekday = new Date(jan4).getUTCDay() || 7
  return jan4 + (1 - weekday) * DAY_MS + (week - 1) * 7 * DAY_MS
}

function isoWeekOf(time: number): IsoWeek {
  const date = new Date(time)
  const weekday = date.getUTCDay() || 7
  // The Thursday of the same ISO week decides its year.
  const thursday = new Date(time + (4 - weekday) * DAY_MS)
  const year = thursday.getUTCFullYear()
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7)
  return { year, week }
}

function formatUtcDate(time: number) {
  return new Date(time).toISOString().slice(0, 10)
}

/** 周一、周日日期（YYYY-MM-DD）。 */
export function isoWeekDateRange(year: number, week: number) {
  const start = isoWeekStartUtc(year, week)
  return { start: formatUtcDate(start), end: formatUtcDate(start + 6 * DAY_MS) }
}

/** 相对所选周前后移动若干周，跨年时自动换算周年份。 */
export function shiftIsoWeek(year: number, week: number, delta: number): IsoWeek {
  return isoWeekOf(isoWeekStartUtc(year, week) + delta * 7 * DAY_MS)
}

function wholeNumber(value: unknown) {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  return /^\d{1,4}$/.test(text) ? Number(text) : Number.NaN
}

/**
 * 解析用户直接输入的年份与周次；无效输入返回 null。
 * 52 周年份输入第 53 周会归一为下一年第 1 周（与左右切换一致）。
 */
export function normalizeIsoWeekInput(yearValue: unknown, weekValue: unknown): IsoWeek | null {
  const year = wholeNumber(yearValue)
  const week = wholeNumber(weekValue)
  if (!Number.isInteger(year) || year < 1970 || year > 9999 || !Number.isInteger(week) || week < 1 || week > 53) return null
  return isoWeekOf(isoWeekStartUtc(year, week))
}
