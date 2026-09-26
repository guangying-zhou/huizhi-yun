// The legacy Assets due-notification entries answer 409 with this code once the
// unified scheduler owns them; the local cron then has nothing to do.
// data-runtime writes errors as { error: { code, message, retryable, requestId } }.
export function isUnifiedAssetsDueNotificationOwner(error: unknown) {
  const value = error as { statusCode?: unknown, data?: { error?: { code?: unknown } } } | null
  return value?.statusCode === 409 && value?.data?.error?.code === 'assets_due_notifications_unified_owner'
}
