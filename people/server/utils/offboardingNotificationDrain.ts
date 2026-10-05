import type { H3Event } from 'h3'
import { fetchDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import { advanceNotificationActionableLifecycle } from '@hzy/foundation/server/utils/notifications'
import { sendNotification } from '@hzy/foundation/server/utils/notify'
import { checkSubjectEligibility } from '@hzy/foundation/server/utils/subjectEligibility'
import {
  peopleOffboardingAuthorizationDescriptor,
  peopleOffboardingEventType,
  peopleOffboardingMessage,
  peopleOffboardingNotificationsEnabled,
  requirePeopleOffboardingRuntimePage,
  resolvePeopleOffboardingRecipient,
  type DirectoryUser,
  type PeopleOffboardingCandidate,
  type PeopleOffboardingClosure
} from './offboardingNotificationPolicy.js'
import { deliverPeopleOffboardingNotificationCandidate } from './offboardingNotificationDelivery.js'
import {
  callPeopleDueNotificationRuntime,
  requirePeopleDueNotificationRuntimeBinding
} from './scheduledRuntime.js'

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

async function acknowledge(candidate: PeopleOffboardingCandidate, notificationId: string, recipientUid: string) {
  await callPeopleDueNotificationRuntime('/v1/people/service/notifications:acknowledge', {
    eventVersion: candidate.eventVersion,
    notificationId,
    recipientUid
  })
}

async function acknowledgeClosure(closure: PeopleOffboardingClosure) {
  await callPeopleDueNotificationRuntime('/v1/people/service/notifications:acknowledge-closure', {
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
    sourceAppCode: 'people',
    actionableKey: input.actionableKey,
    expectedVersion: input.expectedVersion,
    nextVersion: input.nextVersion,
    state: input.state,
    recipients: [input.recipientUid]
  })
}

async function closeDueCondition(closure: PeopleOffboardingClosure) {
  await closeActionable({
    actionableKey: closure.actionableKey,
    expectedVersion: closure.expectedVersion,
    nextVersion: closure.nextVersion,
    state: closure.state,
    recipientUid: closure.recipientUid
  })
  await acknowledgeClosure(closure)
}

async function deliverCandidate(event: H3Event, candidate: PeopleOffboardingCandidate) {
  const descriptor = peopleOffboardingAuthorizationDescriptor(candidate)
  const message = peopleOffboardingMessage(candidate)
  await deliverPeopleOffboardingNotificationCandidate({
    event,
    candidate,
    dependencies: {
      resolveActiveDirectRecipient: async candidate => await resolvePeopleOffboardingRecipient(candidate, findActiveUser),
      closePreviousRecipient: closeActionable,
      checkEligibility: checkSubjectEligibility,
      send: async recipientUid => await sendNotification({
        touser: recipientUid,
        sourceAppCode: 'people',
        eventType: peopleOffboardingEventType(candidate.stream),
        category: 'offboarding',
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
          targetAppCode: 'people',
          bizKey: `people:offboarding_task:${candidate.taskCode}`,
          objectVersion: candidate.eventVersion,
          ...(candidate.previousEventVersion
            ? { previousObjectVersion: candidate.previousEventVersion }
            : {}),
          target: { appCode: 'people', ...descriptor },
          authorizationDescriptor: descriptor,
          eventVersion: candidate.eventVersion,
          actionableKey: candidate.actionableKey,
          stream: candidate.stream,
          phase: candidate.phase,
          caseCode: candidate.caseCode,
          taskCode: candidate.taskCode,
          taskType: candidate.taskType,
          dueAt: candidate.dueAt
        }
      }),
      acknowledge: async (notificationId, recipientUid) => await acknowledge(candidate, notificationId, recipientUid)
    }
  })
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function scheduledEligibilityEvent(taskContext: unknown) {
  const context = record(taskContext)
  return {
    node: {
      req: {
        headers: { host: 'people-scheduled.internal' },
        method: 'POST',
        url: '/__nitro/tasks/notifications:offboarding-due',
        socket: { encrypted: false }
      },
      res: {}
    },
    context: {
      ...context,
      nitro: record(context.nitro)
    }
  } as unknown as H3Event
}

export function isPeopleOffboardingNotificationDeliveryEnabled() {
  const config = useRuntimeConfig() as unknown as {
    hzy?: { notifications?: { offboardingEnabled?: unknown } }
  }
  return peopleOffboardingNotificationsEnabled(
    process.env.HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED
    ?? config.hzy?.notifications?.offboardingEnabled
  )
}

export async function drainPeopleOffboardingNotifications(options: {
  event?: H3Event
  taskContext?: unknown
  pageSize?: number
  maxPagesPerStream?: number
  maxWallTimeMs?: number
} = {}) {
  if (!isPeopleOffboardingNotificationDeliveryEnabled()) {
    return { enabled: false, scanned: 0, delivered: 0, failed: 0, stoppedBy: 'feature_flag' }
  }
  requirePeopleDueNotificationRuntimeBinding()
  const event = options.event || scheduledEligibilityEvent(options.taskContext || {})

  const pageSize = Math.min(Math.max(options.pageSize || 100, 1), 200)
  const maxPagesPerStream = Math.min(Math.max(options.maxPagesPerStream || 10, 1), 50)
  const maxWallTimeMs = Math.min(Math.max(options.maxWallTimeMs || 45_000, 1_000), 55_000)
  const startedAt = Date.now()
  const asOf = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  let scanned = 0
  let delivered = 0
  let failed = 0
  let stoppedBy = 'empty'

  for (const stream of [
    'offboarding_handover_due',
    'offboarding_asset_recovery_due'
  ] as const) {
    let cursor = ''
    for (let pageIndex = 0; pageIndex < maxPagesPerStream; pageIndex += 1) {
      if (Date.now() - startedAt >= maxWallTimeMs) {
        return { enabled: true, asOf, scanned, delivered, failed, stoppedBy: 'wall_time' }
      }
      const runtimePage = await callPeopleDueNotificationRuntime<unknown>(
        '/v1/people/service/notifications:scan-due',
        { stream, asOf, cursor: cursor || undefined, limit: pageSize }
      )
      const page = requirePeopleOffboardingRuntimePage(runtimePage, stream, asOf)
      const failedClosures = new Set<string>()
      for (const closure of page.closures) {
        try {
          await closeDueCondition(closure)
        } catch (error) {
          failed += 1
          failedClosures.add(`${closure.sourceType}:${closure.sourceId}`)
          console.error('[people:notifications:offboarding-due] closure failed', closure.actionableKey, error)
        }
      }
      scanned += page.items.length
      for (const candidate of page.items) {
        if (failedClosures.has(`${candidate.sourceType}:${candidate.sourceId}`)) continue
        try {
          await deliverCandidate(event, candidate)
          delivered += 1
        } catch (error) {
          failed += 1
          console.error('[people:notifications:offboarding-due] candidate failed', candidate.actionableKey, error)
        }
      }
      cursor = text(page.nextCursor)
      if (!cursor) break
      stoppedBy = pageIndex + 1 >= maxPagesPerStream ? 'page_budget' : stoppedBy
    }
  }
  return { enabled: true, asOf, scanned, delivered, failed, stoppedBy }
}
