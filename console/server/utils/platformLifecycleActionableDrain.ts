import type { H3Event } from 'h3'
import {
  cancelConsolePlatformLifecycleRetry,
  getConsolePlatformLifecycleRetrySource
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getConsoleApplicationCatalog } from './userApplications'
import { resolveNotificationActionUrl } from '@hzy/foundation/shared/utils/notificationActionUrl'
import { publishPortalNotification, advancePortalActionableLifecycleForService } from './notifications'
import {
  callConsoleTenantRuntimeTask,
  callConsoleTenantRuntimeTaskForEvent
} from './consoleTenantRuntimeTaskClient'
import {
  platformLifecycleActionableIdentity,
  platformLifecycleActionableMetadata,
  platformLifecycleClosure,
  type PlatformLifecycleActionablePhase
} from './platformLifecycleActionable'

export interface PlatformLifecycleRetrySource {
  operationId: string
  tenantCode: string
  deploymentCode: string
  operationCode: 'console.platform.employment-sync.v1' | 'console.platform.offboarding-revoke.v1'
  requiredCapability: string
  idempotencyKey: string
  commandSchemaVersion: string
  command: Record<string, unknown>
  commandSha256: string
  positionCode: string
  positionName: string
  deptCode: string
}

interface RuntimeActionableCandidate {
  operationId: string
  uid: string
  operationCode: string
  originalActorUid: string | null
  recipients: string[]
  generation: number
  actionableKey: string
  objectVersion: string
  idempotencyKey: string
}

interface RuntimeActionableClosure {
  operationId: string
  uid: string
  operationCode: string
  status: string
  generation: number
  actionableKey: string
  objectVersion: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function phaseForOperation(operationCode: string): PlatformLifecycleActionablePhase | null {
  if (operationCode === 'console.platform.employment-sync.v1') return 'employment_authorization_sync'
  if (operationCode === 'console.platform.offboarding-revoke.v1') return 'offboarding_authorization_reclaim'
  return null
}

function retryUrl(phase: PlatformLifecycleActionablePhase, uid: string) {
  const params = new URLSearchParams({
    tab: 'lifecycle',
    source_app: 'directory',
    phase,
    uid
  })
  return `/admin/logs?${params.toString()}`
}

async function catalogBoundConsoleActionUrl(path: string, event?: H3Event) {
  const config = useRuntimeConfig() as { public?: Record<string, unknown> }
  const origin = text(config.public?.deploymentPublicUrl || process.env.HZY_DEPLOYMENT_PUBLIC_URL)
  if (!origin) throw new Error('Console deployment public URL is unavailable for actionable target binding')
  const applications = await getConsoleApplicationCatalog(event || undefined as never)
  const actionUrl = resolveNotificationActionUrl({
    actionUrl: path,
    actionTargetAppCode: 'console',
    sourceAppCode: 'console'
  }, applications, origin)
  if (!actionUrl) throw new Error('Console signed application catalog rejected lifecycle actionable target')
  return actionUrl
}

async function runtimeTask<T>(
  event: H3Event | undefined,
  path: `/v1/console/${string}`,
  options: { method?: 'GET' | 'POST', body?: Record<string, unknown>, query?: Record<string, unknown> } = {}
) {
  return event
    ? await callConsoleTenantRuntimeTaskForEvent<T>(event, path, options)
    : await callConsoleTenantRuntimeTask<T>(path, options)
}

async function prepareActionables(limit: number, event?: H3Event) {
  return await runtimeTask<{
    data: {
      candidates: RuntimeActionableCandidate[]
      closures: RuntimeActionableClosure[]
    }
  }>(event, '/v1/console/platform-lifecycle/actionables/prepare', {
    method: 'POST',
    body: { limit }
  })
}

async function checkpointActionable(body: Record<string, unknown>, event?: H3Event) {
  return await runtimeTask(
    event,
    '/v1/console/platform-lifecycle/actionables/checkpoint',
    { method: 'POST', body }
  )
}

async function drainPlatformLifecycleActionablesWithEvent(
  event: H3Event | undefined,
  options: { limit?: number } = {}
) {
  const limit = Math.min(Math.max(Number(options.limit || 10), 1), 10)
  const prepared = await prepareActionables(limit, event)
  let published = 0
  let closed = 0
  let failed = 0

  for (const row of prepared.data.candidates) {
    const phase = phaseForOperation(row.operationCode)
    if (!phase || !row.recipients.length) continue
    try {
      const identity = platformLifecycleActionableIdentity({
        operationId: row.operationId,
        uid: row.uid,
        phase,
        generation: row.generation
      })
      if (
        identity.actionableKey !== row.actionableKey
        || identity.objectVersion !== row.objectVersion
        || identity.idempotencyKey !== row.idempotencyKey
      ) {
        throw new Error('Tenant Runtime lifecycle actionable identity mismatch')
      }
      const notification = await publishPortalNotification({
        sourceAppCode: 'console',
        eventType: 'console.platform_lifecycle.dead_letter',
        category: 'authorization_lifecycle',
        severity: 'error',
        title: phase === 'employment_authorization_sync' ? '主岗位授权同步需要处理' : '离职授权回收需要处理',
        summary: '授权生命周期任务已进入死信队列，需要在 Console 审计与生命周期页面受控处理。',
        body: '该授权生命周期任务尚未完成。请查看审计记录并执行受控重试。',
        actionUrl: await catalogBoundConsoleActionUrl(retryUrl(phase, identity.uid), event),
        bizType: 'people_lifecycle_authorization',
        bizId: identity.uid,
        idempotencyKey: identity.idempotencyKey,
        recipients: row.recipients,
        channels: ['in_app'],
        metadata: platformLifecycleActionableMetadata(identity)
      }, { actorId: 'console-directory-runtime', appCode: 'console' }, event)
      await checkpointActionable({
        operationId: identity.operationId,
        generation: identity.generation,
        checkpoint: 'published',
        notificationId: notification.notificationId
      }, event)
      published += 1
    } catch (error) {
      failed += 1
      console.warn('[console] platform lifecycle actionable remains pending', {
        operationId: row.operationId,
        error: error instanceof Error ? error.message : String(error)
      })
      break
    }
  }

  for (const row of prepared.data.closures) {
    const phase = phaseForOperation(row.operationCode)
    if (!phase) continue
    try {
      const identity = platformLifecycleActionableIdentity({
        operationId: row.operationId,
        uid: row.uid,
        phase,
        generation: row.generation
      })
      if (identity.actionableKey !== row.actionableKey || identity.objectVersion !== row.objectVersion) {
        throw new Error('Tenant Runtime lifecycle closure identity mismatch')
      }
      const state = row.status === 'succeeded' ? 'resolved' : 'cancelled'
      await advancePortalActionableLifecycleForService(
        platformLifecycleClosure(identity, state),
        { appCode: 'console' },
        event
      )
      await checkpointActionable({
        operationId: identity.operationId,
        generation: identity.generation,
        checkpoint: 'closed',
        state
      }, event)
      closed += 1
    } catch (error) {
      failed += 1
      console.warn('[console] platform lifecycle actionable closure remains pending', {
        operationId: row.operationId,
        error: error instanceof Error ? error.message : String(error)
      })
      break
    }
  }
  return { published, closed, failed }
}

export async function drainPlatformLifecycleActionables(options: { limit?: number } = {}) {
  return await drainPlatformLifecycleActionablesWithEvent(undefined, options)
}

export async function drainPlatformLifecycleActionablesForEvent(
  event: H3Event,
  options: { limit?: number } = {}
) {
  return await drainPlatformLifecycleActionablesWithEvent(event, options)
}

export async function loadDeadLetterPlatformLifecycleRetrySource(input: {
  event: H3Event
  uid: string
  phase: PlatformLifecycleActionablePhase
}): Promise<PlatformLifecycleRetrySource | null> {
  const response = await getConsolePlatformLifecycleRetrySource(input.event, {
    uid: input.uid,
    phase: input.phase
  })
  return response.data
}

export async function cancelDeadLetterPlatformLifecycleForRetry(input: {
  event: H3Event
  uid: string
  phase: PlatformLifecycleActionablePhase
  operationId: string
}) {
  const response = await cancelConsolePlatformLifecycleRetry(input.event, {
    uid: input.uid,
    phase: input.phase,
    operationId: input.operationId
  })
  return response.data
}
