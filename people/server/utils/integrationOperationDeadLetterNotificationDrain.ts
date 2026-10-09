import { drainIntegrationOperationDeadLetterNotifications } from '@hzy/foundation/server/utils/integrationOperationDeadLetterDrain'
import { publishIntegrationOperationDeadLetter } from '@hzy/foundation/server/utils/notifications'
import {
  callPeopleScheduledRuntime,
  requirePeopleScheduledRuntimeBinding
} from './scheduledRuntime'

type Row = Record<string, unknown>

function text(value: unknown) {
  return String(value || '').trim()
}

function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Row
    : {}
}

function enabled(value: unknown) {
  return ['1', 'true', 'yes', 'on'].includes(text(value).toLowerCase())
}

// Kept separate from Directory→Console and People→Assets claim drains. A
// notification transport failure must never decide whether a frozen business
// operation is claimed, retried, succeeded or failed.
export function peopleIntegrationOperationDeadLetterNotificationsEnabled() {
  const config = useRuntimeConfig() as unknown as Row
  const notifications = record(record(config.hzy).notifications)
  return enabled(
    notifications.integrationOperationDeadLetterEnabled
    ?? process.env.HZY_PEOPLE_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED
  )
}

export async function drainPeopleIntegrationOperationDeadLetterNotifications(options: { limit?: number } = {}) {
  // Check the rollout gate before reading a runtime binding, minting either
  // service token, or making a Console/runtime network request.
  if (!peopleIntegrationOperationDeadLetterNotificationsEnabled()) {
    return { enabled: false, published: 0, closed: 0, failures: 0 }
  }

  if (options.limit !== undefined && options.limit !== 1) {
    throw new Error('People dead-letter notification drain accepts exactly one source generation per run.')
  }

  const binding = requirePeopleScheduledRuntimeBinding()
  // One source generation per 15-minute run bounds the Console/runtime calls
  // well below the 25-second reserve that protects the separate business
  // operation drains.
  const limit = 1
  const callRuntime = <T>(path: string, body: Row) => callPeopleScheduledRuntime<T>(path, {
    scope: 'people.write people:integration_operation:execute',
    body
  })

  try {
    const result = await drainIntegrationOperationDeadLetterNotifications('people', binding, {
      callRuntime,
      publish: item => publishIntegrationOperationDeadLetter(item, null),
      warn: (message, context) => console.warn(`[people:integration-operations:dead-letter] ${message}`, context)
    }, limit)
    return { enabled: true, ...result }
  } catch (error) {
    // The source operation remains intact and can be scanned again. Never
    // surface this transport error into either caller-owned claim drain.
    console.warn('[people:integration-operations:dead-letter] drain remains pending', {
      error: error instanceof Error ? error.message : String(error)
    })
    return { enabled: true, published: 0, closed: 0, failures: 1 }
  }
}
