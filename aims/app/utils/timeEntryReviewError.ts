import { aimsApiErrorCode, aimsApiErrorStatus } from './weeklyReportingError'

const reviewErrorMessages: Readonly<Record<string, string>> = Object.freeze({
  time_entry_review_version_conflict: '所选工时已被他人处理或已变更，列表已刷新，请重新确认',
  time_entry_reviewer_changed: '审核人已变更，您不再是这些工时的审核人',
  time_entry_self_review_denied: '不能审核自己的工时'
})

export function isTimeEntryReviewVersionConflict(error: unknown): boolean {
  return aimsApiErrorStatus(error) === 409 && aimsApiErrorCode(error) === 'time_entry_review_version_conflict'
}

export function timeEntryReviewErrorMessage(error: unknown): string | null {
  return reviewErrorMessages[aimsApiErrorCode(error)] || null
}
