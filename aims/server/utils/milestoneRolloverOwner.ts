// The legacy rollover entry answers 409 with this code once the unified
// scheduler owns rollover; the local cron then has nothing to do. data-runtime
// writes errors as { error: { code, message, retryable, requestId } }.
export function isUnifiedMilestoneRolloverOwner(error: unknown) {
  return isRuntimeOwnerRefusal(error, 'aims_milestone_rollover_unified_owner')
}

// Same refusal for the legacy due-notification entries.
export function isUnifiedDueNotificationOwner(error: unknown) {
  return isRuntimeOwnerRefusal(error, 'aims_due_notifications_unified_owner')
}

function isRuntimeOwnerRefusal(error: unknown, code: string) {
  const value = error as { statusCode?: unknown, data?: { error?: { code?: unknown } } } | null
  return value?.statusCode === 409 && value?.data?.error?.code === code
}
