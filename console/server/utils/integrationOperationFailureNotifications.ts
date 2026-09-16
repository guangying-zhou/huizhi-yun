import { createHash } from 'node:crypto'
import { createError, type H3Event } from 'h3'
import { getConsoleDirectoryUsersBatch } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import {
  integrationOperationActionUrl,
  integrationOperationActionableMetadata,
  validateIntegrationOperationFailureNotificationInput,
  type IntegrationOperationFailureNotificationInput
} from './integrationOperationFailureNotificationContract'
import { getSystemParameter } from '~~/server/utils/systemParameters'
import { publishPortalNotification } from '~~/server/utils/notifications'
import { deliverLifecycleFailureNotification } from '~~/server/utils/platformAuthorizationLifecycleNotificationDelivery'
import type { VaultActor } from '~~/server/utils/vault'
import {
  NOTIFICATION_ACTION_TARGET_CATALOG_BINDING,
  resolveRegisteredNotificationActionTarget
} from './notificationActionTarget'

export const INTEGRATION_OPERATION_NOTIFICATION_RECIPIENTS_SETTING = 'notification.integrationOperationRecipients'

function text(value: unknown) {
  return String(value || '').trim()
}

function notificationIdempotencyKey(input: IntegrationOperationFailureNotificationInput) {
  const digest = createHash('sha256')
    .update([input.tenantCode, input.deploymentCode, input.sourceApp, input.operationId, input.generation ?? 'legacy'].join('|'))
    .digest('hex')
  return `integration-operation-dead-letter:${digest}`
}

async function filterActiveDirectoryUsers(event: H3Event, uids: string[]) {
  if (uids.length === 0) return []
  const envelope = await getConsoleDirectoryUsersBatch(event, uids)
  const rows = envelope.data as Array<{ uid?: unknown, status?: unknown, statusKey?: unknown }>
  const active = new Set(rows
    .filter(row => text(row.statusKey || row.status) === 'active' || text(row.status) === '1')
    .map(row => text(row.uid)))
  return uids.filter(uid => active.has(uid))
}

export async function notifyIntegrationOperationDeadLetter(
  event: H3Event,
  raw: unknown,
  actor: VaultActor,
  dependencies: {
    resolveActionUrl?: typeof resolveRegisteredNotificationActionTarget
    deliver?: typeof deliverLifecycleFailureNotification
  } = {}
) {
  const input = validateIntegrationOperationFailureNotificationInput(raw, actor)
  const actionUrl = await (dependencies.resolveActionUrl || resolveRegisteredNotificationActionTarget)(event, {
    actionUrl: integrationOperationActionUrl(input),
    actionTargetAppCode: input.sourceApp,
    sourceAppCode: input.sourceApp
  })
  const actionableMetadata = integrationOperationActionableMetadata(input)
  const boundActionableMetadata = Object.keys(actionableMetadata).length > 0
    ? {
        ...actionableMetadata,
        // resolveRegisteredNotificationActionTarget above has already bound
        // this exact URL to the signed catalog before any delivery attempt.
        actionTargetCatalogBinding: NOTIFICATION_ACTION_TARGET_CATALOG_BINDING
      }
    : actionableMetadata
  const delivery = await (dependencies.deliver || deliverLifecycleFailureNotification)({ operatorUid: input.originalActorUid }, {
    loadConfiguredRecipients: () => getSystemParameter(INTEGRATION_OPERATION_NOTIFICATION_RECIPIENTS_SETTING),
    filterActiveRecipients: uids => filterActiveDirectoryUsers(event, uids),
    publish: recipients => publishPortalNotification({
      sourceAppCode: input.sourceApp,
      eventType: 'integration_operation.dead_letter',
      category: 'integration_operation',
      severity: 'error',
      title: '跨应用任务需要人工处理',
      summary: `${input.sourceApp} 到 ${input.targetApp} 的任务在 ${input.attemptCount}/${input.maxAttempts} 次尝试后进入死信队列。`,
      body: `业务对象 ${input.sourceBizType}:${input.sourceBizCode} 的跨应用处理失败，请在源应用的任务诊断中检查并受控重放。`,
      actionUrl,
      bizType: 'integration_operation',
      bizId: input.operationId,
      idempotencyKey: notificationIdempotencyKey(input),
      recipients,
      channels: ['in_app'],
      metadata: boundActionableMetadata
    }, actor, event),
    warn: (warning, context) => console.warn(warning, { operationId: input.operationId, ...context })
  })

  if (!delivery.ok) {
    throw createError({
      statusCode: 503,
      message: delivery.delivery === 'operation_log_only'
        ? 'no active integration operation notification recipient is configured'
        : 'integration operation notification delivery failed'
    })
  }
  return {
    notificationId: delivery.published.notificationId,
    sourceAppCode: delivery.published.sourceAppCode,
    recipients: delivery.recipients,
    recipientSource: delivery.recipientSource,
    channels: delivery.published.channels
  }
}
