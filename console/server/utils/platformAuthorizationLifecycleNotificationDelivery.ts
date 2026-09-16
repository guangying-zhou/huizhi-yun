export interface LifecycleNotificationRecipientDependencies<TPublished> {
  loadConfiguredRecipients: () => Promise<unknown>
  filterActiveRecipients: (uids: string[]) => Promise<string[]>
  publish: (recipients: string[]) => Promise<TPublished>
  warn?: (message: string, context: Record<string, unknown>) => void
}

export type LifecycleNotificationDeliveryResult<TPublished>
  = | { ok: true, delivery: 'portal', recipientSource: 'operator' | 'configured_fallback', recipients: string[], published: TPublished }
    | { ok: false, delivery: 'operation_log_only', reason: 'missing_operator_and_fallback_recipients' }
    | { ok: false, delivery: 'failed', error: string }

function text(value: unknown) {
  return String(value || '').trim()
}

function uniqueUids(values: unknown[]) {
  return [...new Set(values.map(text).filter(Boolean))]
}

export function parseLifecycleNotificationRecipients(value: unknown) {
  if (Array.isArray(value)) return uniqueUids(value)
  const raw = text(value)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return uniqueUids(parsed)
  } catch {
    // Fall through to CSV for backwards-compatible settings input.
  }
  return uniqueUids(raw.split(','))
}

function warn(
  callback: LifecycleNotificationRecipientDependencies<unknown>['warn'],
  message: string,
  context: Record<string, unknown>
) {
  if (callback) callback(message, context)
  else console.warn(message, context)
}

export async function deliverLifecycleFailureNotification<TPublished>(
  input: { operatorUid?: unknown, targetUid?: unknown },
  dependencies: LifecycleNotificationRecipientDependencies<TPublished>
): Promise<LifecycleNotificationDeliveryResult<TPublished>> {
  const targetUid = text(input.targetUid)
  const operatorUid = text(input.operatorUid)

  try {
    if (operatorUid && operatorUid !== targetUid) {
      const activeOperators = uniqueUids(await dependencies.filterActiveRecipients([operatorUid]))
      if (activeOperators.length > 0) {
        const published = await dependencies.publish(activeOperators)
        return { ok: true, delivery: 'portal', recipientSource: 'operator', recipients: activeOperators, published }
      }
    }

    const configured = parseLifecycleNotificationRecipients(await dependencies.loadConfiguredRecipients())
      .filter(uid => uid !== targetUid)
    const fallbackRecipients = uniqueUids(await dependencies.filterActiveRecipients(configured))
    if (fallbackRecipients.length === 0) {
      warn(dependencies.warn, '[console] Lifecycle notification has no active recipient; failure remains in operation log queue.', {
        targetUid,
        operatorProvided: Boolean(operatorUid)
      })
      return {
        ok: false,
        delivery: 'operation_log_only',
        reason: 'missing_operator_and_fallback_recipients'
      }
    }

    const published = await dependencies.publish(fallbackRecipients)
    return {
      ok: true,
      delivery: 'portal',
      recipientSource: 'configured_fallback',
      recipients: fallbackRecipients,
      published
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown error')
    warn(dependencies.warn, '[console] Failed to resolve or publish lifecycle notification:', { error: message })
    return { ok: false, delivery: 'failed', error: message }
  }
}
