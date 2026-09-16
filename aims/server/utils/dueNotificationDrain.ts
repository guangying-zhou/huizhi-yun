import { sendNotification } from '@hzy/foundation/server/utils/notify'
import { checkSubjectEligibility } from '@hzy/foundation/server/utils/subjectEligibility'
import type { H3Event } from 'h3'
import {
  advanceNotificationActionableLifecycle
} from '@hzy/foundation/server/utils/notifications'
import { fetchDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import { callAimsDueNotificationRuntime, requireAimsDueNotificationRuntimeBinding } from './scheduledRuntime'
import { runAimsDueEligibilityGate } from './dueNotificationEligibility'
import {
  aimsDueEventType,
  aimsDueMessage,
  aimsDueNotificationsEnabled,
  aimsDueRecipientTransition,
  resolveAimsDueRecipient,
  type AimsDueCandidate,
  type AimsDueClosure,
  type AimsDueStream,
  type DirectoryUser
} from './dueNotificationPolicy'

interface RuntimePage {
  stream: AimsDueStream
  asOf: string
  items: AimsDueCandidate[]
  closures?: AimsDueClosure[]
  nextCursor?: string | null
}

interface DirectoryEnvelope<T> {
  code?: number
  data?: T
}

function text(value: unknown) {
  return String(value || '').trim()
}

async function findActiveUser(uid: string) {
  try {
    const response = await fetchDirectoryApi<DirectoryEnvelope<DirectoryUser>>(
      `/api/v1/directory/users/${encodeURIComponent(uid)}`
    )
    return response.code === 0 ? response.data || null : null
  } catch {
    return null
  }
}

function notificationIdFromValue(value: unknown) {
  if (!value || typeof value !== 'object') return ''
  return text((value as Record<string, unknown>).notificationId)
}

function durableInAppNotificationId(error: unknown) {
  if (!error || typeof error !== 'object') return ''
  const result = (error as { result?: { inApp?: { status?: string, value?: unknown } } }).result
  return result?.inApp?.status === 'fulfilled' ? notificationIdFromValue(result.inApp.value) : ''
}

async function acknowledge(candidate: AimsDueCandidate, notificationId: string, recipientUid: string) {
  await callAimsDueNotificationRuntime('/v1/aims/service/notifications:acknowledge', {
    eventVersion: candidate.eventVersion,
    notificationId,
    recipientUid
  })
}

async function acknowledgeClosure(closure: AimsDueClosure) {
  await callAimsDueNotificationRuntime('/v1/aims/service/notifications:acknowledge-closure', { eventVersion: closure.checkpointEventVersion, nextVersion: closure.nextVersion })
}

async function closeActionable(input: {
  actionableKey: string
  expectedVersion: string
  nextVersion: string
  state: 'resolved' | 'cancelled'
  recipientUid: string
}) {
  await advanceNotificationActionableLifecycle({
    sourceAppCode: 'aims',
    actionableKey: input.actionableKey,
    expectedVersion: input.expectedVersion,
    nextVersion: input.nextVersion,
    state: input.state,
    recipients: [input.recipientUid]
  })
}

async function closeDueCondition(closure: AimsDueClosure) {
  await closeActionable({
    actionableKey: closure.actionableKey,
    expectedVersion: closure.expectedVersion,
    nextVersion: closure.nextVersion,
    state: closure.state,
    recipientUid: closure.recipientUid
  })
  await acknowledgeClosure(closure)
}

async function deliverCandidate(event: H3Event, candidate: AimsDueCandidate) {
  const recipientUid = await resolveAimsDueRecipient(candidate, { findActiveUser })
  if (!recipientUid) throw new Error(`No active responsible recipient for ${candidate.actionableKey}`)
  const transition = aimsDueRecipientTransition(candidate, recipientUid)
  return await runAimsDueEligibilityGate({
    purpose: candidate.stream,
    closePreviousRecipient: transition.previousRecipientClosure
      ? async () => await closeActionable({
        actionableKey: candidate.actionableKey,
        expectedVersion: transition.previousRecipientClosure!.expectedVersion,
        nextVersion: `owner-moved:${candidate.eventVersion}`,
        state: 'cancelled',
        recipientUid: transition.previousRecipientClosure!.recipientUid
      })
      : undefined,
    checkEligibility: async purpose => await checkSubjectEligibility({ event, subjectUid: recipientUid, purpose }),
    deliver: async () => {
      const message = aimsDueMessage(candidate)
      try {
        const delivery = await sendNotification({
          touser: recipientUid,
          sourceAppCode: 'aims',
          eventType: aimsDueEventType(candidate.stream),
          category: candidate.stream === 'work_item_due' ? 'project-risk' : 'service-sla',
          severity: candidate.phase === 'breached' || candidate.phase === 'overdue' ? 'error' : 'warning',
          title: message.title,
          description: message.description,
          url: message.url,
          btntxt: '查看工作项',
          bizType: 'work_item',
          bizId: candidate.workItemId,
          idempotencyKey: candidate.idempotencyKey,
          metadata: {
            actionableState: 'pending',
            targetAppCode: 'aims',
            bizKey: `aims:work_item:${candidate.workItemId}`,
            objectVersion: candidate.eventVersion,
            ...(transition.previousObjectVersion
              ? { previousObjectVersion: transition.previousObjectVersion }
              : {}),
            target: { appCode: 'aims', resource: 'work_item', id: String(candidate.workItemId) },
            authorizationDescriptor: { resource: 'work_item', id: String(candidate.workItemId) },
            eventVersion: candidate.eventVersion,
            actionableKey: candidate.actionableKey,
            phase: candidate.phase,
            dueAt: candidate.dueAt,
            projectId: candidate.projectId,
            workItemId: candidate.workItemId
          }
        })
        const notificationId = notificationIdFromValue(delivery.inApp.value)
        if (!notificationId) throw new Error(`Console did not return notification evidence for ${candidate.actionableKey}`)
        await acknowledge(candidate, notificationId, recipientUid)
      } catch (error) {
        const notificationId = durableInAppNotificationId(error)
        if (notificationId) await acknowledge(candidate, notificationId, recipientUid)
        throw error
      }
    }
  })
}

function taskEligibilityEvent(taskContext: Record<string, unknown> = {}) {
  return {
    context: taskContext,
    node: {
      req: { headers: {}, method: 'POST', url: '/__nitro/tasks/notifications:due' },
      res: {}
    }
  } as unknown as H3Event
}

export function isAimsDueNotificationDeliveryEnabled() {
  const config = useRuntimeConfig() as unknown as { hzy?: { notifications?: { dueEnabled?: unknown } } }
  return aimsDueNotificationsEnabled(
    process.env.HZY_AIMS_DUE_NOTIFICATIONS_ENABLED
    ?? config.hzy?.notifications?.dueEnabled
  )
}

export async function drainAimsDueNotifications(options: {
  pageSize?: number
  maxPagesPerStream?: number
  maxWallTimeMs?: number
  event?: H3Event
  taskContext?: Record<string, unknown>
} = {}) {
  if (!isAimsDueNotificationDeliveryEnabled()) {
    return { enabled: false, scanned: 0, delivered: 0, failed: 0, stoppedBy: 'feature_flag' }
  }
  requireAimsDueNotificationRuntimeBinding()
  const eligibilityEvent = options.event || taskEligibilityEvent(options.taskContext)
  const pageSize = Math.min(Math.max(options.pageSize || 100, 1), 200)
  const maxPagesPerStream = Math.min(Math.max(options.maxPagesPerStream || 10, 1), 50)
  const maxWallTimeMs = Math.min(Math.max(options.maxWallTimeMs || 45_000, 1_000), 55_000)
  const startedAt = Date.now()
  const asOf = new Date().toISOString()
  let scanned = 0
  let delivered = 0
  let failed = 0
  let stoppedBy = 'empty'

  for (const stream of ['response_due', 'resolution_due', 'work_item_due'] as const) {
    let cursor = ''
    for (let pageIndex = 0; pageIndex < maxPagesPerStream; pageIndex += 1) {
      if (Date.now() - startedAt >= maxWallTimeMs) {
        stoppedBy = 'wall_time'
        return { enabled: true, asOf, scanned, delivered, failed, stoppedBy }
      }
      const page = await callAimsDueNotificationRuntime<RuntimePage>('/v1/aims/service/notifications:scan-due', { stream, asOf, cursor: cursor || undefined, limit: pageSize })
      const failedClosures = new Set<string>()
      for (const closure of page.closures || []) {
        try {
          await closeDueCondition(closure)
        } catch (error) {
          failed += 1
          failedClosures.add(`${stream}:${closure.workItemId}`)
          console.error('[notifications:due] closure failed', closure.actionableKey, error)
        }
      }
      scanned += page.items.length
      for (const candidate of page.items) {
        if (failedClosures.has(`${stream}:${candidate.workItemId}`)) continue
        try {
          await deliverCandidate(eligibilityEvent, candidate)
          delivered += 1
        } catch (error) {
          failed += 1
          console.error('[notifications:due] candidate failed', candidate.actionableKey, error)
        }
      }
      cursor = text(page.nextCursor)
      if (!cursor) break
      stoppedBy = pageIndex + 1 >= maxPagesPerStream ? 'page_budget' : stoppedBy
    }
  }
  return { enabled: true, asOf, scanned, delivered, failed, stoppedBy }
}
