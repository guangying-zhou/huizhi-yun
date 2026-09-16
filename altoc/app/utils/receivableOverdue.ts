/**
 * 回款计划逾期判断与逾期天数口径。
 *
 * 看板、列表和详情页必须共用同一口径，否则同一条计划在不同页面会显示不同的逾期状态。
 * 与 tenant-runtime 侧 `dashboard_reads.go` 保持一致：已收和坏账不算逾期，
 * 计划回款日期当天不算逾期。
 */

const MS_PER_DAY = 86_400_000

/** 结清状态：无论日期如何都不再计逾期 */
const SETTLED_STATUSES = new Set(['received', 'bad_debt'])

export interface ReceivablePlanOverdueInput {
  status?: string | null
  planned_payment_date?: string | null
  overdue_days?: number | null
}

/**
 * 把 `YYYY-MM-DD` 或 `YYYY-MM-DD HH:mm:ss` 解析为本地零点。
 * 直接 `new Date('2026-07-25')` 会按 UTC 解析，在东八区会把当天误判成已过期。
 */
function dateOnly(value: string | null | undefined) {
  if (!value) return null
  const text = String(value).trim()
  if (!text) return null
  const normalized = text.length <= 10 ? `${text}T00:00:00` : text.replace(' ', 'T')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return null
  date.setHours(0, 0, 0, 0)
  return date
}

function todayStart() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

/**
 * 是否逾期：已被 runtime 标记 `overdue` 的计划，
 * 以及计划日期已过但扫描任务尚未标记的计划。
 */
export function isReceivablePlanOverdue(plan: ReceivablePlanOverdueInput | null | undefined) {
  const status = String(plan?.status || '').trim()
  if (SETTLED_STATUSES.has(status)) return false
  if (status === 'overdue') return true
  const due = dateOnly(plan?.planned_payment_date)
  if (!due) return false
  return due.getTime() < todayStart().getTime()
}

/**
 * 逾期天数：优先取 runtime 维护的 `overdue_days`；
 * 扫描任务尚未跑到时按计划日期兜底推算，避免详情页显示「逾期 0 天」。
 */
export function receivableOverdueDays(plan: ReceivablePlanOverdueInput | null | undefined) {
  const tracked = Number(plan?.overdue_days ?? 0)
  if (Number.isFinite(tracked) && tracked > 0) return Math.floor(tracked)
  if (!isReceivablePlanOverdue(plan)) return 0
  const due = dateOnly(plan?.planned_payment_date)
  if (!due) return 0
  const elapsed = todayStart().getTime() - due.getTime()
  // 夏令时会让某天只有 23 小时，用 round 而不是 floor 避免少算一天
  return elapsed > 0 ? Math.round(elapsed / MS_PER_DAY) : 0
}
