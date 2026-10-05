import { fetchDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import { advanceNotificationActionableLifecycle } from '@hzy/foundation/server/utils/notifications'
import { sendNotification } from '@hzy/foundation/server/utils/notify'
import { checkSubjectEligibility, type SubjectEligibilityResult } from '@hzy/foundation/server/utils/subjectEligibility'
import type { H3Event } from 'h3'
import {
  receivableDueDescriptor, receivableDueMessage, receivableDueNotificationsEnabled,
  requireReceivableDueRuntimePage, resolveReceivableDueRecipient,
  type DirectoryUser, type ReceivableDueCandidate, type ReceivableDueClosure
} from './receivableDueNotificationPolicy'
import { callAltocReceivableDueRuntime, requireAltocReceivableDueRuntimeBinding } from './receivableScheduledRuntime'
import { runReceivableDueEligibilityDelivery } from './receivableDueEligibilityDelivery'

function text(value: unknown) {
  return String(value || '').trim()
}
async function activeUser(uid: string) {
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
async function close(closure: ReceivableDueClosure) {
  await advanceNotificationActionableLifecycle({ sourceAppCode: 'altoc', actionableKey: closure.actionableKey, expectedVersion: closure.expectedVersion, nextVersion: closure.nextVersion, state: closure.state, recipients: [closure.recipientUid] })
  await callAltocReceivableDueRuntime('/v1/altoc/service/notifications:acknowledge-closure', { eventVersion: closure.checkpointEventVersion, nextVersion: closure.nextVersion })
}

interface ReceivableDueDeliveryDependencies {
  findRecipient: (candidate: ReceivableDueCandidate) => Promise<string | null>
  closePreviousRecipient: (candidate: ReceivableDueCandidate, recipientUid: string) => Promise<void>
  checkEligibility: (event: H3Event, candidate: ReceivableDueCandidate, recipientUid: string) => Promise<SubjectEligibilityResult>
  send: typeof sendNotification
  acknowledge: (candidate: ReceivableDueCandidate, notificationId: string, recipientUid: string) => Promise<unknown>
}

const receivableDueDeliveryDependencies: ReceivableDueDeliveryDependencies = {
  findRecipient: candidate => resolveReceivableDueRecipient(candidate, activeUser),
  closePreviousRecipient: async (candidate, recipientUid) => {
    if (candidate.previousEventVersion && candidate.previousRecipientUid && candidate.previousRecipientUid !== recipientUid) {
      await advanceNotificationActionableLifecycle({ sourceAppCode: 'altoc', actionableKey: candidate.actionableKey, expectedVersion: candidate.previousEventVersion, nextVersion: `owner-moved:${candidate.eventVersion}`, state: 'cancelled', recipients: [candidate.previousRecipientUid] })
    }
  },
  checkEligibility: (event, candidate, recipientUid) => checkSubjectEligibility({
    event,
    subjectUid: recipientUid,
    purpose: candidate.stream
  }),
  send: sendNotification,
  acknowledge: (candidate, id, recipientUid) => callAltocReceivableDueRuntime('/v1/altoc/service/notifications:acknowledge', { eventVersion: candidate.eventVersion, notificationId: id, recipientUid })
}

export async function deliverAltocReceivableDueCandidate(
  event: H3Event,
  candidate: ReceivableDueCandidate,
  dependencies: ReceivableDueDeliveryDependencies = receivableDueDeliveryDependencies
) {
  const recipientUid = await dependencies.findRecipient(candidate)
  if (!recipientUid) throw new Error(`No active direct collection responsible user for ${candidate.actionableKey}`)
  return await runReceivableDueEligibilityDelivery({
    closePreviousRecipient: () => dependencies.closePreviousRecipient(candidate, recipientUid),
    checkEligibility: () => dependencies.checkEligibility(event, candidate, recipientUid),
    deliver: async () => {
      const descriptor = receivableDueDescriptor(candidate)
      const message = receivableDueMessage(candidate)
      try {
        const result = await dependencies.send({
          touser: recipientUid, sourceAppCode: 'altoc', eventType: 'altoc.receivable_plan.due', category: 'receivable',
          severity: candidate.phase === 'expired' ? 'error' : 'warning', title: message.title, description: message.description,
          url: message.url, btntxt: message.buttonText, bizType: descriptor.resource, bizId: descriptor.id,
          idempotencyKey: candidate.idempotencyKey,
          metadata: {
            actionableState: 'pending', targetAppCode: 'altoc', bizKey: `altoc:receivable_plan:${candidate.sourceCode}`,
            objectVersion: candidate.eventVersion, ...(candidate.previousEventVersion ? { previousObjectVersion: candidate.previousEventVersion } : {}),
            target: { appCode: 'altoc', ...descriptor }, authorizationDescriptor: descriptor,
            eventVersion: candidate.eventVersion, actionableKey: candidate.actionableKey, stream: candidate.stream, phase: candidate.phase, dueAt: candidate.dueAt
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
      req: { headers: {}, method: 'POST', url: '/__nitro/tasks/notifications:receivable-due' },
      res: {}
    }
  } as unknown as H3Event
}
export function isAltocReceivableDueEnabled() {
  const config = useRuntimeConfig() as unknown as { hzy?: { notifications?: { receivableDueEnabled?: unknown } } }
  return receivableDueNotificationsEnabled(process.env.HZY_ALTOC_RECEIVABLE_DUE_NOTIFICATIONS_ENABLED ?? config.hzy?.notifications?.receivableDueEnabled)
}
export async function drainAltocReceivableDue(options: {
  pageSize?: number
  maxPages?: number
  maxWallTimeMs?: number
  event?: H3Event
  taskContext?: Record<string, unknown>
} = {}) {
  if (!isAltocReceivableDueEnabled()) return { enabled: false, scanned: 0, delivered: 0, failed: 0, stoppedBy: 'feature_flag' }
  requireAltocReceivableDueRuntimeBinding()
  const eligibilityEvent = options.event || taskEligibilityEvent(options.taskContext)
  const pageSize = Math.min(Math.max(options.pageSize || 100, 1), 200)
  const maxPages = Math.min(Math.max(options.maxPages || 10, 1), 50)
  const wall = Math.min(Math.max(options.maxWallTimeMs || 45_000, 1000), 55_000)
  const started = Date.now()
  const asOf = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  let cursor = ''
  let scanned = 0
  let delivered = 0
  let failed = 0
  let stoppedBy = 'empty'
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    if (Date.now() - started >= wall) return { enabled: true, asOf, scanned, delivered, failed, stoppedBy: 'wall_time' }
    const page = requireReceivableDueRuntimePage(await callAltocReceivableDueRuntime('/v1/altoc/service/notifications:scan-due', { stream: 'receivable_plan_due', asOf, cursor: cursor || undefined, limit: pageSize }), asOf)
    const blocked = new Set<string>()
    for (const closure of page.closures) {
      try {
        await close(closure)
      } catch (error) {
        failed += 1
        blocked.add(`${closure.sourceType}:${closure.sourceId}`)
        console.error('[altoc:receivable-due] closure failed', closure.actionableKey, error)
      }
    }
    scanned += page.items.length
    for (const candidate of page.items) {
      if (blocked.has(`${candidate.sourceType}:${candidate.sourceId}`)) continue
      try {
        await deliverAltocReceivableDueCandidate(eligibilityEvent, candidate)
        delivered += 1
      } catch (error) {
        failed += 1
        console.error('[altoc:receivable-due] candidate failed', candidate.actionableKey, error)
      }
    }
    cursor = text(page.nextCursor)
    if (!cursor) break
    if (pageIndex + 1 >= maxPages) stoppedBy = 'page_budget'
  }
  return { enabled: true, asOf, scanned, delivered, failed, stoppedBy }
}
