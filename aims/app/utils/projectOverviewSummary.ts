// Pure summary of a project's milestones for the overview page.

export interface OverviewMilestone {
  id: number
  name: string
  status: string
  startDate: string | null
  endDate: string | null
  sortOrder?: number
  progress?: number | null
}

export interface OverviewMember {
  uid: string
  role: string
  realName?: string
}

function localToday(now: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function milestoneOverview(milestones: OverviewMilestone[], now = new Date()) {
  const today = localToday(now)
  const active = milestones.filter(item => item.status !== 'cancelled')
  const items = [...active]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.endDate || '9999').localeCompare(b.endDate || '9999'))
    .map((item) => {
      const done = item.status === 'completed'
      const rollup = Number(item.progress)
      const progress = done ? 100 : Number.isFinite(rollup) ? Math.max(0, Math.min(100, Math.round(rollup))) : 0
      return { ...item, progress, overdue: !done && Boolean(item.endDate) && item.endDate!.slice(0, 10) < today }
    })
  const completed = items.filter(item => item.status === 'completed').length
  const progress = items.length ? Math.round(items.reduce((sum, item) => sum + item.progress, 0) / items.length) : 0
  const next = items
    .filter(item => item.status !== 'completed' && item.endDate)
    .sort((a, b) => a.endDate!.localeCompare(b.endDate!))[0] || null
  return { items, total: items.length, completed, progress, next, overdue: items.filter(item => item.overdue) }
}
