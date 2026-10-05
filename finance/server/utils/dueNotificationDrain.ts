import { fetchDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import { advanceNotificationActionableLifecycle } from '@hzy/foundation/server/utils/notifications'
import { sendNotification } from '@hzy/foundation/server/utils/notify'
import { checkSubjectEligibility, type SubjectEligibilityResult } from '@hzy/foundation/server/utils/subjectEligibility'
import type { H3Event } from 'h3'
import {
  financeDueAuthorizationDescriptor,
  financeDueEventType,
  financeDueMessage,
  financeDueNotificationsEnabled,
  requireFinanceDueRuntimePage,
  resolveFinanceDueRecipient,
  type DirectoryUser,
  type FinanceDueCandidate,
  type FinanceDueClosure,
  type FinanceDueStream
} from './dueNotificationPolicy'
import { callFinanceDueNotificationRuntime, requireFinanceDueNotificationRuntimeBinding } from './scheduledRuntime'
import { runDueEligibilityDelivery } from './dueEligibilityDelivery'

function text(value: unknown) {
  return String(value || '').trim()
}
async function findActiveUser(uid: string) {
  try {
    const response = await fetchDirectoryApi<{ code?: number, data?: DirectoryUser }>(`/api/v1/directory/users/${encodeURIComponent(uid)}`)
    return response.code === 0 ? response.data || null : null
  } catch {
    return null
  }
}
function notificationId(value: unknown) {
  return value && typeof value === 'object' ? text((value as Record<string, unknown>).notificationId) : ''
}
function durableId(error: unknown) {
  if (!error || typeof error !== 'object') return ''
  const inApp = (error as { result?: { inApp?: { status?: string, value?: unknown } } }).result?.inApp
  return inApp?.status === 'fulfilled' ? notificationId(inApp.value) : ''
}
async function closeActionable(closure: FinanceDueClosure) {
  await advanceNotificationActionableLifecycle({
    sourceAppCode: 'finance', actionableKey: closure.actionableKey, expectedVersion: closure.expectedVersion,
    nextVersion: closure.nextVersion, state: closure.state, recipients: [closure.recipientUid]
  })
  await callFinanceDueNotificationRuntime('/v1/finance/service/notifications:acknowledge-closure', {
    eventVersion: closure.checkpointEventVersion, nextVersion: closure.nextVersion
  })
}

interface FinanceDueDeliveryDependencies {
  findRecipient: (candidate: FinanceDueCandidate) => Promise<string | null>
  closePreviousRecipient: (candidate: FinanceDueCandidate, recipientUid: string) => Promise<void>
  checkEligibility: (event: H3Event, candidate: FinanceDueCandidate, recipientUid: string) => Promise<SubjectEligibilityResult>
  send: typeof sendNotification
  acknowledge: (candidate: FinanceDueCandidate, notificationId: string, recipientUid: string) => Promise<unknown>
}

const financeDueDeliveryDependencies: FinanceDueDeliveryDependencies = {
  findRecipient: candidate => resolveFinanceDueRecipient(candidate, findActiveUser),
  closePreviousRecipient: async (candidate, recipientUid) => {
    if (candidate.previousEventVersion && candidate.previousRecipientUid && candidate.previousRecipientUid !== recipientUid) {
      await advanceNotificationActionableLifecycle({
        sourceAppCode: 'finance', actionableKey: candidate.actionableKey, expectedVersion: candidate.previousEventVersion,
        nextVersion: `owner-moved:${candidate.eventVersion}`, state: 'cancelled', recipients: [candidate.previousRecipientUid]
      })
    }
  },
  checkEligibility: (event, candidate, recipientUid) => checkSubjectEligibility({
    event,
    subjectUid: recipientUid,
    purpose: candidate.stream
  }),
  send: sendNotification,
  acknowledge: (candidate, id, recipientUid) => callFinanceDueNotificationRuntime('/v1/finance/service/notifications:acknowledge', {
    eventVersion: candidate.eventVersion, notificationId: id, recipientUid
  })
}

export async function deliverFinanceDueCandidate(
  event: H3Event,
  candidate: FinanceDueCandidate,
  dependencies: FinanceDueDeliveryDependencies = financeDueDeliveryDependencies
) {
  const recipientUid = await dependencies.findRecipient(candidate)
  if (!recipientUid) throw new Error(`No active direct Finance recipient for ${candidate.actionableKey}`)
  return await runDueEligibilityDelivery({
    closePreviousRecipient: () => dependencies.closePreviousRecipient(candidate, recipientUid),
    checkEligibility: () => dependencies.checkEligibility(event, candidate, recipientUid),
    deliver: async () => {
      const descriptor = financeDueAuthorizationDescriptor(candidate)
      const message = financeDueMessage(candidate)
      try {
        const result = await dependencies.send({
          touser: recipientUid,
          sourceAppCode: 'finance',
          eventType: financeDueEventType(candidate.stream),
          category: 'finance_due',
          severity: candidate.phase === 'expired' ? 'error' : 'warning',
          title: message.title,
          description: message.description,
          url: message.url,
          btntxt: message.buttonText,
          bizType: descriptor.resource,
          bizId: descriptor.id,
          idempotencyKey: candidate.idempotencyKey,
          metadata: {
            actionableState: 'pending', targetAppCode: 'finance',
            bizKey: `finance:${descriptor.resource}:${descriptor.id}`,
            objectVersion: candidate.eventVersion,
            ...(candidate.previousEventVersion ? { previousObjectVersion: candidate.previousEventVersion } : {}),
            target: { appCode: 'finance', ...descriptor },
            authorizationDescriptor: descriptor,
            eventVersion: candidate.eventVersion,
            actionableKey: candidate.actionableKey,
            stream: candidate.stream,
            phase: candidate.phase,
            dueAt: candidate.dueAt
          }
        })
        const id = notificationId(result.inApp.value)
        if (!id) throw new Error(`Console did not return notification evidence for ${candidate.actionableKey}`)
        await dependencies.acknowledge(candidate, id, recipientUid)
      } catch (error) {
        const id = durableId(error)
        if (id) await dependencies.acknowledge(candidate, id, recipientUid)
        throw error
      }
    }
  })
}

function taskEligibilityEvent(taskContext: Record<string, unknown> = {}) {
  return {
    context: taskContext,
    node: {
      req: { headers: {}, method: 'POST', url: '/__nitro/tasks/notifications:finance-due' },
      res: {}
    }
  } as unknown as H3Event
}

export function isFinanceDueNotificationDeliveryEnabled() {
  const config = useRuntimeConfig() as unknown as { hzy?: { notifications?: { dueEnabled?: unknown } } }
  return financeDueNotificationsEnabled(process.env.HZY_FINANCE_DUE_NOTIFICATIONS_ENABLED ?? config.hzy?.notifications?.dueEnabled)
}

export async function drainFinanceDueNotifications(options: {
  pageSize?: number
  maxPagesPerStream?: number
  maxWallTimeMs?: number
  event?: H3Event
  taskContext?: Record<string, unknown>
} = {}) {
  if (!isFinanceDueNotificationDeliveryEnabled()) return { enabled: false, scanned: 0, delivered: 0, failed: 0, stoppedBy: 'feature_flag' }
  requireFinanceDueNotificationRuntimeBinding()
  const eligibilityEvent = options.event || taskEligibilityEvent(options.taskContext)
  const pageSize = Math.min(Math.max(options.pageSize || 100, 1), 200)
  const maxPages = Math.min(Math.max(options.maxPagesPerStream || 10, 1), 50)
  const wall = Math.min(Math.max(options.maxWallTimeMs || 45_000, 1000), 55_000)
  const started = Date.now()
  const asOf = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  let scanned = 0
  let delivered = 0
  let failed = 0
  let stoppedBy = 'empty'
  for (const stream of ['invoice_issuance_due', 'receipt_reconciliation_due'] as FinanceDueStream[]) {
    let cursor = ''
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      if (Date.now() - started >= wall) return { enabled: true, asOf, scanned, delivered, failed, stoppedBy: 'wall_time' }
      const page = requireFinanceDueRuntimePage(await callFinanceDueNotificationRuntime('/v1/finance/service/notifications:scan-due', {
        stream, asOf, ...(cursor ? { cursor } : {}), limit: pageSize
      }), stream, asOf)
      const blocked = new Set<string>()
      for (const closure of page.closures) {
        try {
          await closeActionable(closure)
        } catch (error) {
          failed += 1
          blocked.add(`${closure.sourceType}:${closure.sourceId}`)
          console.error('[finance:notifications:due] closure failed', closure.actionableKey, error)
        }
      }
      scanned += page.items.length
      for (const candidate of page.items) {
        if (blocked.has(`${candidate.sourceType}:${candidate.sourceId}`)) continue
        try {
          await deliverFinanceDueCandidate(eligibilityEvent, candidate)
          delivered += 1
        } catch (error) {
          failed += 1
          console.error('[finance:notifications:due] candidate failed', candidate.actionableKey, error)
        }
      }
      cursor = text(page.nextCursor)
      if (!cursor) break
      if (pageIndex + 1 >= maxPages) stoppedBy = 'page_budget'
    }
  }
  return { enabled: true, asOf, scanned, delivered, failed, stoppedBy }
}
