// Pure helpers for the Enterprise workbench; no network or component state.

export interface WorkbenchWorkItem {
  id: number
  projectId: number
  projectName: string
  itemKey: string
  title: string
  status: string
  dueDate: string | null
}

export type WorkbenchWorkTab = 'active' | 'dueThisWeek' | 'inReview'

const OPEN_STATUSES = new Set(['planning', 'todo', 'in_progress', 'in_review'])

export const workItemStatusMeta: Record<string, { label: string, color: 'neutral' | 'info' | 'primary' | 'warning' | 'success' }> = {
  planning: { label: '规划中', color: 'neutral' },
  todo: { label: '待办', color: 'info' },
  in_progress: { label: '执行中', color: 'primary' },
  in_review: { label: '确认中', color: 'warning' },
  completed: { label: '已完成', color: 'success' }
}

export const projectLifecycleMeta: Record<string, { label: string, color: 'neutral' | 'info' | 'primary' | 'warning' | 'success' }> = {
  draft: { label: '草稿', color: 'neutral' },
  approval_pending: { label: '立项审批中', color: 'warning' },
  active: { label: '进行中', color: 'primary' },
  paused: { label: '已暂停', color: 'neutral' },
  completed: { label: '已完成', color: 'success' },
  archived: { label: '已归档', color: 'neutral' }
}

export const projectRoleLabel: Record<string, string> = { manager: '项目经理', member: '成员', viewer: '查看者' }

function localDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Monday..Sunday of the week containing `now`, as local YYYY-MM-DD keys. */
export function currentWeekRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { startDate: localDateKey(start), endDate: localDateKey(end), today: localDateKey(now) }
}

/** ISO-8601 week number. */
export function isoWeekNumber(now = new Date()) {
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export function greetingFor(now = new Date()) {
  const hour = now.getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '上午好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export function isOpenWorkItem(item: Pick<WorkbenchWorkItem, 'status'>) {
  return OPEN_STATUSES.has(item.status)
}

/** Items shown under each tab; `dueThisWeek` includes overdue open items. */
export function workItemsForTab(items: WorkbenchWorkItem[], tab: WorkbenchWorkTab, now = new Date()) {
  const { endDate } = currentWeekRange(now)
  const open = items.filter(isOpenWorkItem)
  const selected = tab === 'inReview'
    ? open.filter(item => item.status === 'in_review')
    : tab === 'dueThisWeek'
      ? open.filter(item => item.dueDate && item.dueDate.slice(0, 10) <= endDate)
      : open.filter(item => item.status === 'todo' || item.status === 'in_progress')
  return [...selected].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
}

export function dueLabel(dueDate: string | null, now = new Date()) {
  if (!dueDate) return { text: '—', overdue: false }
  const { today } = currentWeekRange(now)
  const key = dueDate.slice(0, 10)
  if (key < today) return { text: `逾期 ${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`, overdue: true }
  if (key === today) return { text: '今天', overdue: true }
  return { text: `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`, overdue: false }
}

export function relativeTime(value: string | null | undefined, now = new Date()) {
  if (!value) return ''
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ''
  const minutes = Math.max(0, Math.round((now.getTime() - time) / 60000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.round(hours / 24)
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  const date = new Date(time)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

/** Sum of hours from a user's time entries, tolerating array or page payloads. */
export function sumEntryHours(payload: unknown) {
  const rows = Array.isArray(payload) ? payload : ((payload as { items?: unknown[] } | null)?.items || [])
  let total = 0
  for (const row of rows) {
    const hours = Number((row as { hours?: unknown })?.hours)
    if (Number.isFinite(hours) && hours > 0) total += hours
  }
  return Math.round(total * 10) / 10
}
