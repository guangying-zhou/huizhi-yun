import { projectTimeWeekWindow } from './timeEntryPagination'

export type TimeEntryReviewStatus = 'draft' | 'submitted' | 'approved' | 'returned'

export function reviewStatusLabel(status: TimeEntryReviewStatus) {
  return {
    draft: '草稿',
    submitted: '待审核',
    approved: '已确认',
    returned: '已退回'
  }[status]
}

export function reviewStatusColor(status: TimeEntryReviewStatus): 'neutral' | 'warning' | 'success' | 'error' {
  if (status === 'submitted') return 'warning'
  if (status === 'approved') return 'success'
  if (status === 'returned') return 'error'
  return 'neutral'
}

/** 项目工时页默认区间：报告时区下的本周（周一至周日），与页头“本周工时”口径一致。 */
export function defaultTimesheetRange(now: Date, timezone = 'Asia/Shanghai') {
  const { weekStart, weekEnd } = projectTimeWeekWindow(now, timezone)
  return { startDate: weekStart, endDate: weekEnd }
}
