export interface WeeklyDetailPage<T> { items: T[], total: number, page: number, pageSize: number }
export interface WeeklyHistory { cumulativeLaborCost: number | null, progressPercent: number | null, progressYear: number, progressWeek: number }
export interface WeeklyPeriodPage<T> {
  periodKey: string
  editableByCurrentUser: boolean
  report: T | null
  baseline?: T | null
  summary: { persistedRecognizedHours: number, persistedMemberCount: number, initializationMemberCount: number, persistedAllocationPercentAverage: number, persistedWorkloadDays: number }
  history: WeeklyHistory
  entriesPage: WeeklyDetailPage<string>
  workItemsPage: WeeklyDetailPage<number>
}
export function isWeeklyPeriodPage<T>(raw: unknown, page: number, size: number): raw is WeeklyPeriodPage<T> {
  if (!raw || typeof raw !== 'object') return false
  const v = raw as WeeklyPeriodPage<T>
  return typeof v.periodKey === 'string' && typeof v.editableByCurrentUser === 'boolean' && Boolean(v.history) && Boolean(v.summary) && Number.isFinite(v.summary.persistedWorkloadDays)
    && [v.entriesPage, v.workItemsPage].every(p => p && Array.isArray(p.items) && p.items.length <= size && Number.isSafeInteger(p.total) && p.total >= 0 && p.page === page && p.pageSize === size)
    && v.entriesPage.items.every(uid => typeof uid === 'string') && v.workItemsPage.items.every(id => Number.isSafeInteger(id) && id > 0)
}

/** Complete initialization baseline plus keyed edits. Persisted replacement
 * contracts must never serialize the currently visible page alone. */
export function weeklyDraftTotals<T extends { uid: string, hours: number, actualHours: number, allocationPercent: number }>(baseline: readonly T[], draft: readonly T[]) {
  const original = new Map(baseline.map(row => [row.uid, row]))
  let hours = baseline.reduce((n, r) => n + r.hours, 0)
  let actual = baseline.reduce((n, r) => n + r.actualHours, 0)
  let percent = baseline.reduce((n, r) => n + r.allocationPercent, 0)
  for (const row of draft) {
    const before = original.get(row.uid)
    hours += row.hours - (before?.hours || 0)
    actual += row.actualHours - (before?.actualHours || 0)
    percent += row.allocationPercent - (before?.allocationPercent || 0)
    original.delete(row.uid)
  }
  for (const removed of original.values()) {
    hours -= removed.hours
    actual -= removed.actualHours
    percent -= removed.allocationPercent
  }
  const round = (n: number) => Math.round(n * 100) / 100
  return { hours: round(hours), actual: round(actual), averagePercent: draft.length ? round(percent / draft.length) : 0, memberCount: draft.length }
}

export function weeklyDraftWorkload<T extends { id?: number, workloadDays: number | null }>(persistedTotal: number, baseline: readonly T[], draft: readonly T[]) {
  const original = new Map(baseline.map((item, index) => [item.id ? `saved:${item.id}` : `new:${index}`, item]))
  let total = persistedTotal
  for (const [index, item] of draft.entries()) {
    const key = item.id ? `saved:${item.id}` : `new:${index}`
    total += Number(item.workloadDays || 0) - Number(original.get(key)?.workloadDays || 0)
    original.delete(key)
  }
  for (const item of original.values()) total -= Number(item.workloadDays || 0)
  return Math.round(total * 100) / 100
}
