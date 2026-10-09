export interface WeeklySummaryTotals {
  total: number
  filled: number
  currentDays: number
  actualDays: number
  previousDays: number
  deltaDays: number
  memberSlots: number
  cumulativeLaborCost: number
}
export interface WeeklySummaryRank {
  projectId: number
  name: string
  code: string
  value: number
  previousValue?: number
  delta?: number
}
export interface WeeklySummaryPage<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  summary: WeeklySummaryTotals
  charts: Record<'workload' | 'members' | 'change' | 'cost', WeeklySummaryRank[]>
  meta: { weekStart: string, weekEnd: string }
}
export function isWeeklySummaryPage<T>(raw: unknown, page: number, size: number): raw is WeeklySummaryPage<T> {
  if (!raw || typeof raw !== 'object') return false
  const v = raw as WeeklySummaryPage<T>
  if (v.page !== page || v.pageSize !== size || !Array.isArray(v.items) || v.items.length > size || !Number.isSafeInteger(v.total) || v.total < 0) return false
  if (!v.summary || !v.charts || !v.meta || typeof v.meta.weekStart !== 'string' || typeof v.meta.weekEnd !== 'string') return false
  if (!['total', 'filled', 'currentDays', 'actualDays', 'previousDays', 'deltaDays', 'memberSlots', 'cumulativeLaborCost'].every(k => Number.isFinite(v.summary[k as keyof WeeklySummaryTotals]))) return false
  if (v.summary.total < v.total || v.summary.filled > v.summary.total) return false
  return (['workload', 'members', 'change', 'cost'] as const).every(k => Array.isArray(v.charts[k]) && v.charts[k].length <= (k === 'workload' ? 11 : 14) && v.charts[k].every(row => Number.isFinite(row.value) && typeof row.name === 'string' && typeof row.code === 'string' && Number.isSafeInteger(row.projectId)))
}
