import { optionalReadPagination } from './optionalReadPagination'

export const timeEntrySummaryQueryKeys = ['calendarProjectId', 'monthStart', 'monthEnd', 'todayDate', 'weekStart', 'weekEnd'] as const

/** Only read filters/summary anchors; actor and permission facts come from the server. */
export function timeEntryReadQuery(query: Record<string, unknown>, target: 'user' | 'project') {
  const allowed = ['page', 'pageSize', 'startDate', 'endDate', ...timeEntrySummaryQueryKeys, ...(target === 'user' ? ['projectId', 'cycleCode'] : ['uid', 'includeUidHours'])]
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key) || typeof value !== 'string' || !value || value !== value.trim() || value.length > 200 || /[\0\r\n]/.test(value)) throw new Error('Invalid time entry query')
    result[key] = value
  }
  const pagination = optionalReadPagination(query)
  const paged = Object.keys(pagination).length > 0
  if (!paged && timeEntrySummaryQueryKeys.some(key => key in result)) throw new Error('Summary requires pagination')
  if ('includeUidHours' in result && (!paged || result.includeUidHours !== '1')) throw new Error('Invalid UID summary')
  for (const key of ['projectId', 'calendarProjectId']) if (key in result && (!/^[1-9]\d*$/.test(result[key]!) || !Number.isSafeInteger(Number(result[key])))) throw new Error('Invalid project ID')
  for (const key of ['startDate', 'endDate', 'monthStart', 'monthEnd', 'todayDate', 'weekStart', 'weekEnd']) {
    if (!(key in result)) continue
    const value = result[key]!
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('Invalid date')
  }
  if (result.startDate && result.endDate && result.startDate > result.endDate) throw new Error('Invalid date range')
  if (Boolean(result.monthStart) !== Boolean(result.monthEnd)) throw new Error('Incomplete month')
  if (result.monthStart) {
    const date = new Date(`${result.monthStart}T00:00:00Z`)
    if (date.getUTCDate() !== 1) throw new Error('Invalid month start')
    date.setUTCMonth(date.getUTCMonth() + 1)
    date.setUTCDate(0)
    if (date.toISOString().slice(0, 10) !== result.monthEnd) throw new Error('Invalid month end')
  }
  if (Boolean(result.weekStart) !== Boolean(result.weekEnd)) throw new Error('Incomplete week')
  if (result.weekStart) {
    const date = new Date(`${result.weekStart}T00:00:00Z`)
    if (date.getUTCDay() !== 1) throw new Error('Invalid week start')
    date.setUTCDate(date.getUTCDate() + 6)
    if (date.toISOString().slice(0, 10) !== result.weekEnd) throw new Error('Invalid week end')
  }
  return result
}
