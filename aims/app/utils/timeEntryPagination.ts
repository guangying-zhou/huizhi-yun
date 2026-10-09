export interface TimeEntrySummary {
  totalHours: number
  monthHours: number
  todayHours: number
  weekHours: number
  positiveDays: number
  monthPositiveDays: number
  monthMissingDays: number
  dailyHours: Array<{ date: string, hours: number, entryCount: number }>
  dailyProjectHours: Array<{ date: string, projectId: number, projectCode: string, projectName: string, hours: number, entryCount: number }>
  baseDailyProjectHours: TimeEntrySummary['dailyProjectHours']
  weeklyHours: Array<{ weekStart: string, weekEnd: string, hours: number, entryCount: number }>
  projectHours: Array<{ projectId: number, hours: number, distinctEntryDays: number }>
  weekStatusCounts: Record<string, number>
}
export interface TimeEntryPage<T> { items: T[], total: number, page: number, pageSize: number, summary: TimeEntrySummary, calendarTimezone?: string, calendarToday?: string }

export function isTimeEntryPage<T>(data: unknown, page: number, pageSize: number): data is TimeEntryPage<T> {
  if (!data || typeof data !== 'object') return false
  const d = data as TimeEntryPage<T>, s = d.summary
  const count = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0
  const hours = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
  if (!Array.isArray(d.items) || d.items.length > pageSize || !count(d.total) || d.page !== page || d.pageSize !== pageSize || !s) return false
  if (!['totalHours', 'monthHours', 'todayHours', 'weekHours'].every(k => hours(s[k as keyof TimeEntrySummary]))) return false
  if (!['positiveDays', 'monthPositiveDays', 'monthMissingDays'].every(k => count(s[k as keyof TimeEntrySummary]))) return false
  if (!Array.isArray(s.dailyHours) || !Array.isArray(s.dailyProjectHours) || !Array.isArray(s.baseDailyProjectHours) || !Array.isArray(s.weeklyHours) || !Array.isArray(s.projectHours) || !s.weekStatusCounts) return false
  return s.dailyHours.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && hours(r.hours) && count(r.entryCount))
    && s.dailyProjectHours.every(r => typeof r.projectCode === 'string' && typeof r.projectName === 'string' && count(r.projectId) && r.projectId > 0 && hours(r.hours) && count(r.entryCount))
    && s.baseDailyProjectHours.every(r => hours(r.hours) && count(r.entryCount) && count(r.projectId))
    && s.weeklyHours.every(r => hours(r.hours) && count(r.entryCount))
    && s.projectHours.every(r => count(r.projectId) && r.projectId > 0 && hours(r.hours) && count(r.distinctEntryDays))
    && ['draft', 'returned', 'submitted', 'approved'].every(k => count(s.weekStatusCounts[k]))
}

/** The configured reporting timezone determines the calendar day. ISO dates
 * are then calculated in UTC so the browser's locale never moves Monday. */
export function reportingToday(now: Date, timezone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const field = (type: string) => parts.find(part => part.type === type)?.value || ''
  return `${field('year')}-${field('month')}-${field('day')}`
}

export function projectTimeWeekWindow(now: Date, timezone = 'Asia/Shanghai') {
  const todayDate = reportingToday(now, timezone)
  const [year, month, day] = todayDate.split('-').map(Number)
  const utc = Date.UTC(year!, month! - 1, day!)
  const weekday = new Date(utc).getUTCDay() || 7
  const date = (offset: number) => new Date(utc + offset * 86_400_000).toISOString().slice(0, 10)
  return { todayDate, weekStart: date(1 - weekday), weekEnd: date(7 - weekday) }
}

export function editedDayHours(base: number, rows: Array<{ hours: number, originalHours: number }>) {
  return Math.round((base + rows.reduce((sum, row) => sum + Math.max(0, Number(row.hours || 0)) - row.originalHours, 0)) * 100) / 100
}

/** Only replace persisted hours after a summary reload, retaining local drafts. */
export function refreshTimeEntryDraftBaselines<T extends { projectId: number, existingHours: number }>(rows: T[], buckets: TimeEntrySummary['baseDailyProjectHours'], date: string): T[] {
  return rows.map(row => ({ ...row, existingHours: buckets.find(bucket => bucket.date === date && bucket.projectId === row.projectId)?.hours || 0 }))
}

export interface TimeEntryReviewPage<T> {
  items: T[]
  periodKey: string
  total: number
  page: number
  pageSize: number
  statusCounts: { submitted: number, approved: number, returned: number }
}
export function isTimeEntryReviewPage<T>(value: unknown, page: number, pageSize: number): value is TimeEntryReviewPage<T> {
  if (!value || typeof value !== 'object') return false
  const data = value as TimeEntryReviewPage<T>
  const counts = data.statusCounts
  return Array.isArray(data.items) && data.items.length <= pageSize && data.page === page && data.pageSize === pageSize
    && /^\d{4}-W\d{2}$/.test(data.periodKey) && Number.isSafeInteger(data.total) && data.total >= 0 && !!counts
    && [counts.submitted, counts.approved, counts.returned].every(n => Number.isSafeInteger(n) && n >= 0)
    && counts.submitted + counts.approved + counts.returned === data.total
}
