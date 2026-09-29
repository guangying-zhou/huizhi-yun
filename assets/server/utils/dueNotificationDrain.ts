import { fetchDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import {
  advanceNotificationActionableLifecycle
} from '@hzy/foundation/server/utils/notifications'
import { sendNotification } from '@hzy/foundation/server/utils/notify'
import { checkSubjectEligibility } from '@hzy/foundation/server/utils/subjectEligibility'
import type { H3Event } from 'h3'
import {
  assetsDueAuthorizationDescriptor,
  assetsDueCategory,
  assetsDueEventType,
  assetsDueMessage,
  assetsDueNotificationsEnabled,
  assetsDueRecipientTransition,
  requireAssetsDueRuntimePage,
  resolveAssetsDueRecipient,
  type AssetsDueCandidate,
  type AssetsDueClosure,
  type DirectoryUser
} from './dueNotificationPolicy'
import {
  callAssetsDueNotificationRuntime,
  requireAssetsDueNotificationRuntimeBinding
} from './scheduledRuntime'
import { runAssetsDueEligibilityGate } from './dueNotificationEligibility'

type DueRuntimeCaller = <T>(path: '/v1/assets/service/notifications:scan-due' | '/v1/assets/service/notifications:acknowledge' | '/v1/assets/service/notifications:acknowledge-closure', body: Record<string, unknown>) => Promise<T>

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

async function acknowledge(runtime: DueRuntimeCaller, candidate: AssetsDueCandidate, notificationId: string, recipientUid: string) {
  await runtime('/v1/assets/service/notifications:acknowledge', {
    stream: candidate.stream,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    eventVersion: candidate.eventVersion,
    notificationId,
    recipientUid
  })
}

async function acknowledgeClosure(runtime: DueRuntimeCaller, closure: AssetsDueClosure) {
  await runtime('/v1/assets/service/notifications:acknowledge-closure', {
    eventVersion: closure.checkpointEventVersion,
    nextVersion: closure.nextVersion
  })
}

async function closeActionable(input: {
  actionableKey: string
  expectedVersion: string
  nextVersion: string
  state: 'resolved' | 'cancelled'
  recipientUid: string
}) {
  await advanceNotificationActionableLifecycle({
    sourceAppCode: 'assets',
    actionableKey: input.actionableKey,
    expectedVersion: input.expectedVersion,
    nextVersion: input.nextVersion,
    state: input.state,
    recipients: [input.recipientUid]
  })
}

async function closeDueCondition(runtime: DueRuntimeCaller, closure: AssetsDueClosure) {
  await closeActionable({
    actionableKey: closure.actionableKey,
    expectedVersion: closure.expectedVersion,
    nextVersion: closure.nextVersion,
    state: closure.state,
    recipientUid: closure.recipientUid
  })
  await acknowledgeClosure(runtime, closure)
}

async function deliverCandidate(runtime: DueRuntimeCaller, event: H3Event, candidate: AssetsDueCandidate) {
  const recipientUid = await resolveAssetsDueRecipient(candidate, { findActiveUser })
  if (!recipientUid) throw new Error(`No active responsible recipient for ${candidate.actionableKey}`)
  const transition = assetsDueRecipientTransition(candidate, recipientUid)
  return await runAssetsDueEligibilityGate({
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
      const descriptor = assetsDueAuthorizationDescriptor(candidate)
      const message = assetsDueMessage(candidate)
      try {
        const delivery = await sendNotification({
          touser: recipientUid,
          sourceAppCode: 'assets',
          eventType: assetsDueEventType(candidate.stream),
          category: assetsDueCategory(candidate.stream),
          severity: candidate.phase === 'expired' ? 'error' : 'warning',
          title: message.title,
          description: message.description,
          url: message.url,
          btntxt: message.buttonText,
          bizType: descriptor.resource,
          bizId: descriptor.id,
          idempotencyKey: candidate.idempotencyKey,
          metadata: {
            actionableState: 'pending',
            targetAppCode: 'assets',
            bizKey: `assets:${descriptor.resource}:${descriptor.id}`,
            objectVersion: candidate.eventVersion,
            ...(transition.previousObjectVersion
              ? { previousObjectVersion: transition.previousObjectVersion }
              : {}),
            target: { appCode: 'assets', ...descriptor },
            authorizationDescriptor: descriptor,
            eventVersion: candidate.eventVersion,
            actionableKey: candidate.actionableKey,
            stream: candidate.stream,
            phase: candidate.phase,
            dueAt: candidate.dueAt
          }
        })
        const notificationId = notificationIdFromValue(delivery.inApp.value)
        if (!notificationId) throw new Error(`Console did not return notification evidence for ${candidate.actionableKey}`)
        await acknowledge(runtime, candidate, notificationId, recipientUid)
      } catch (error) {
        const notificationId = durableInAppNotificationId(error)
        if (notificationId) await acknowledge(runtime, candidate, notificationId, recipientUid)
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

export function isAssetsDueNotificationDeliveryEnabled() {
  const config = useRuntimeConfig() as unknown as { hzy?: { notifications?: { dueEnabled?: unknown } } }
  return assetsDueNotificationsEnabled(
    process.env.HZY_ASSETS_DUE_NOTIFICATIONS_ENABLED
    ?? config.hzy?.notifications?.dueEnabled
  )
}

export async function drainAssetsDueNotifications(options: {
  pageSize?: number
  maxPagesPerStream?: number
  maxWallTimeMs?: number
  event?: H3Event
  taskContext?: Record<string, unknown>
  // The unified scheduler wake supplies a generation-bound caller; the legacy
  // cron uses the purpose-signed worker contract.
  runtime?: DueRuntimeCaller
} = {}) {
  if (!isAssetsDueNotificationDeliveryEnabled()) {
    return { enabled: false, scanned: 0, delivered: 0, failed: 0, stoppedBy: 'feature_flag' }
  }
  requireAssetsDueNotificationRuntimeBinding()
  const runtime: DueRuntimeCaller = options.runtime || callAssetsDueNotificationRuntime
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

  for (const stream of [
    'resource_expiry',
    'ip_expiry',
    'delivery_expiry',
    'delivery_warranty',
    'delivery_support',
    'offboarding_unrecovered'
  ] as const) {
    let cursor = ''
    for (let pageIndex = 0; pageIndex < maxPagesPerStream; pageIndex += 1) {
      if (Date.now() - startedAt >= maxWallTimeMs) {
        return { enabled: true, asOf, scanned, delivered, failed, stoppedBy: 'wall_time' }
      }
      const runtimePage = await runtime<unknown>('/v1/assets/service/notifications:scan-due', { stream, asOf, cursor: cursor || undefined, limit: pageSize })
      const page = requireAssetsDueRuntimePage(runtimePage, stream, asOf)
      const failedClosures = new Set<string>()
      for (const closure of page.closures || []) {
        try {
          await closeDueCondition(runtime, closure)
        } catch (error) {
          failed += 1
          failedClosures.add(`${closure.sourceType}:${closure.sourceId}`)
          console.error('[assets:notifications:due] closure failed', closure.actionableKey, error)
        }
      }
      scanned += page.items.length
      for (const candidate of page.items) {
        if (failedClosures.has(`${candidate.sourceType}:${candidate.sourceId}`)) continue
        try {
          await deliverCandidate(runtime, eligibilityEvent, candidate)
          delivered += 1
        } catch (error) {
          failed += 1
          console.error('[assets:notifications:due] candidate failed', candidate.actionableKey, error)
        }
      }
      cursor = text(page.nextCursor)
      if (!cursor) break
      stoppedBy = pageIndex + 1 >= maxPagesPerStream ? 'page_budget' : stoppedBy
    }
  }
  return { enabled: true, asOf, scanned, delivered, failed, stoppedBy }
}
