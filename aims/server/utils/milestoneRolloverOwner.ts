// The legacy rollover entry answers 409 with this code once the unified
// scheduler owns rollover; the local cron then has nothing to do. data-runtime
// writes errors as { error: { code, message, retryable, requestId } }.
export function isUnifiedMilestoneRolloverOwner(error: unknown) {
  return isRuntimeOwnerRefusal(error, 'aims_milestone_rollover_unified_owner')
    || isRuntimeOwnerRefusal(error, 'aims_milestone_rollover_inprocess_owner')
}

// The signed-wake drain calls through Foundation's tenantRuntimeClient, which
// rethrows Runtime errors as { statusCode, data: { code, upstreamStatus } }.
// Only the in-process scheduler owner refusal is skipped there.
export function isInProcessMilestoneRolloverOwner(error: unknown) {
  const value = error as { statusCode?: unknown, data?: { code?: unknown, upstreamStatus?: unknown } } | null
  return value?.statusCode === 409
    && value?.data?.upstreamStatus === 409
    && value?.data?.code === 'aims_milestone_rollover_inprocess_owner'
}

// Same refusal for the legacy due-notification entries.
export function isUnifiedDueNotificationOwner(error: unknown) {
  return isRuntimeOwnerRefusal(error, 'aims_due_notifications_unified_owner')
}

function isRuntimeOwnerRefusal(error: unknown, code: string) {
  const value = error as { statusCode?: unknown, data?: { error?: { code?: unknown } } } | null
  return value?.statusCode === 409 && value?.data?.error?.code === code
}
