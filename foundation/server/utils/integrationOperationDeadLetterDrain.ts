import type {
  IntegrationOperationDeadLetterClosureInput,
  IntegrationOperationDeadLetterConsoleInput,
  IntegrationOperationDeadLetterNotificationInput,
  IntegrationOperationDeadLetterSourceApp
} from './notifications'

export interface IntegrationOperationDeadLetterDrainBinding {
  tenant: string
  deployment: string
}

export interface IntegrationOperationDeadLetterDrainDependencies {
  callRuntime: <T>(path: string, body: Record<string, unknown>) => Promise<T>
  publish: (item: IntegrationOperationDeadLetterConsoleInput) => Promise<{
    notificationId?: string
    recipients?: string[]
  }>
  warn?: (message: string, context: Record<string, unknown>) => void
}

interface DeadLetterActionablePage {
  items: IntegrationOperationDeadLetterNotificationInput[]
}

interface DeadLetterClosurePage {
  items: IntegrationOperationDeadLetterClosureInput[]
}

function responseStatus(error: unknown) {
  const value = error as { statusCode?: number, status?: number, response?: { status?: number } }
  return Number(value?.statusCode || value?.status || value?.response?.status || 0)
}

function assertBinding(
  item: Pick<IntegrationOperationDeadLetterNotificationInput, 'tenantCode' | 'deploymentCode' | 'sourceApp' | 'operationId'>,
  sourceApp: IntegrationOperationDeadLetterSourceApp,
  binding: IntegrationOperationDeadLetterDrainBinding
) {
  if (item.tenantCode !== binding.tenant || item.deploymentCode !== binding.deployment || item.sourceApp !== sourceApp) {
    throw new Error(`${sourceApp} failure notification escaped its configured tenant/deployment/source binding.`)
  }
  if (!item.operationId) throw new Error(`${sourceApp} failure notification operationId is required.`)
}

function exactRecipientUids(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error('Console dead-letter recipients must contain between 1 and 100 explicit UIDs.')
  }
  const recipients = value.map((item) => {
    const uid = String(item || '').trim()
    const unsafe = [...uid].some((character) => {
      const code = character.codePointAt(0) || 0
      return code < 32 || code === 127
    })
    if (!uid || uid.length > 128 || uid.toLowerCase() === '@all' || unsafe) {
      throw new Error('Console dead-letter recipient UID is invalid.')
    }
    return uid
  })
  if (new Set(recipients).size !== recipients.length) {
    throw new Error('Console dead-letter recipients must be unique.')
  }
  return recipients
}

function assertFrozenPublishIdentity(item: IntegrationOperationDeadLetterNotificationInput) {
  if (
    !Number.isSafeInteger(item.generation) || Number(item.generation) < 1
    || !Number.isSafeInteger(item.operationVersion) || Number(item.operationVersion) < 1
    || !String(item.actionableKey || '').trim()
    || !String(item.objectVersion || '').trim()
  ) throw new Error('Source dead-letter actionable identity is incomplete.')
}

function assertFrozenClosureIdentity(item: IntegrationOperationDeadLetterClosureInput) {
  if (
    !Number.isSafeInteger(item.generation) || item.generation < 1
    || !String(item.actionableKey || '').trim()
    || !String(item.expectedVersion || '').trim()
    || !String(item.nextVersion || '').trim()
    || item.expectedVersion === item.nextVersion
    || !['resolved', 'cancelled'].includes(item.state)
  ) throw new Error('Source dead-letter closure identity is incomplete.')
}

export async function drainIntegrationOperationDeadLetterNotifications(
  sourceApp: IntegrationOperationDeadLetterSourceApp,
  binding: IntegrationOperationDeadLetterDrainBinding,
  dependencies: IntegrationOperationDeadLetterDrainDependencies,
  limit = 3
) {
  let legacy = false
  let page: DeadLetterActionablePage
  try {
    page = await dependencies.callRuntime<DeadLetterActionablePage>(
      `/v1/${sourceApp}/integration-operations:pending-dead-letter-actionables`, { limit }
    )
  } catch (error) {
    if (![404, 405, 501].includes(responseStatus(error))) throw error
    legacy = true
    page = await dependencies.callRuntime<DeadLetterActionablePage>(
      `/v1/${sourceApp}/integration-operations:pending-failure-notifications`, { limit }
    )
  }
  let published = 0
  let failures = 0
  for (const item of page.items || []) {
    assertBinding(item, sourceApp, binding)
    if (!legacy) assertFrozenPublishIdentity(item)
    try {
      const notification = await dependencies.publish(item)
      const notificationId = String(notification.notificationId || '').trim()
      if (!notificationId) throw new Error('Console dead-letter notification id is required.')
      const recipientUids = exactRecipientUids(notification.recipients)
      await dependencies.callRuntime(
        `/v1/${sourceApp}/integration-operations/${encodeURIComponent(item.operationId)}:${legacy ? 'failure-notified' : 'dead-letter-actionable-published'}`,
        legacy
          ? { notificationId }
          : {
              notificationId,
              recipientUids,
              generation: item.generation,
              operationVersion: item.operationVersion,
              actionableKey: item.actionableKey,
              objectVersion: item.objectVersion
            }
      )
      published += 1
    } catch (error) {
      failures += 1
      dependencies.warn?.('Integration operation dead-letter notification remains pending.', {
        sourceApp,
        operationId: item.operationId,
        error: error instanceof Error ? error.message : String(error)
      })
      break
    }
  }

  let closed = 0
  try {
    const closures = await dependencies.callRuntime<DeadLetterClosurePage>(
      `/v1/${sourceApp}/integration-operations:pending-dead-letter-closures`, { limit }
    )
    for (const closure of closures.items || []) {
      assertBinding(closure, sourceApp, binding)
      assertFrozenClosureIdentity(closure)
      try {
        await dependencies.publish(closure)
        await dependencies.callRuntime(
          `/v1/${sourceApp}/integration-operations/${encodeURIComponent(closure.operationId)}:dead-letter-closure-acknowledged`,
          {
            generation: closure.generation,
            actionableKey: closure.actionableKey,
            expectedVersion: closure.expectedVersion,
            nextVersion: closure.nextVersion,
            state: closure.state
          }
        )
        closed += 1
      } catch (error) {
        failures += 1
        dependencies.warn?.('Integration operation dead-letter closure remains pending.', {
          sourceApp, operationId: closure.operationId,
          error: error instanceof Error ? error.message : String(error)
        })
        break
      }
    }
  } catch (error) {
    if (![404, 405, 501].includes(responseStatus(error))) throw error
  }
  return { published, closed, failures }
}
