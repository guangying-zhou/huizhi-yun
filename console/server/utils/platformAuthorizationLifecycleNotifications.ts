import { publishPortalNotification } from '~~/server/utils/notifications'
import type { H3Event } from 'h3'
import { getConsoleDirectoryUsersBatch } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getSystemParameter } from '~~/server/utils/systemParameters'
import { deliverLifecycleFailureNotification } from '~~/server/utils/platformAuthorizationLifecycleNotificationDelivery'

export const LIFECYCLE_NOTIFICATION_RECIPIENTS_SETTING = 'notification.authorizationLifecycleRecipients'

export interface PlatformAuthorizationLifecycleFailureInput {
  uid: string
  operatorUid?: string | null
  idempotencyKey?: string | null
  phase: 'employment_authorization_sync' | 'offboarding_authorization_reclaim'
  message: string
  sourceApp?: string | null
}

function text(value: unknown) {
  return String(value || '').trim()
}

function phaseText(phase: PlatformAuthorizationLifecycleFailureInput['phase']) {
  return phase === 'employment_authorization_sync'
    ? {
        eventType: 'people.lifecycle.platform_employment_authorization_failed',
        title: '主岗位授权同步失败',
        summary: 'People 任职事实已写入 Console Directory，但 Platform 主岗位授权同步失败。',
        operationAction: 'directory.user.employment.from_people'
      }
    : {
        eventType: 'people.lifecycle.platform_offboarding_authorization_failed',
        title: '离职授权回收失败',
        summary: 'People 离职事实已停用 Console 账号，但 Platform 授权回收失败。',
        operationAction: 'directory.user.disable.from_people'
      }
}

function buildLifecycleOperationLogActionUrl(phase: ReturnType<typeof phaseText>, idempotencyKey: string) {
  const params = new URLSearchParams({
    tab: 'operation',
    source_app: 'directory',
    action: phase.operationAction
  })
  if (idempotencyKey) params.set('session_id', idempotencyKey)
  return `/admin/logs?${params.toString()}`
}

export async function notifyPlatformAuthorizationLifecycleFailure(
  input: PlatformAuthorizationLifecycleFailureInput,
  event: H3Event
) {
  const uid = text(input.uid)
  const message = text(input.message) || 'unknown error'
  const idempotencyKey = text(input.idempotencyKey)
  const phase = phaseText(input.phase)
  const retry = {
    endpoint: '/api/v1/console/authorization-lifecycle/retry',
    method: 'POST',
    body: {
      phase: input.phase,
      uid,
      idempotencyKey,
      reason: `manual_${input.phase}_retry`
    }
  }

  const delivery = await deliverLifecycleFailureNotification({
    operatorUid: input.operatorUid,
    targetUid: uid
  }, {
    loadConfiguredRecipients: () => getSystemParameter(LIFECYCLE_NOTIFICATION_RECIPIENTS_SETTING),
    filterActiveRecipients: async (uids) => {
      if (uids.length === 0) return []
      const envelope = await getConsoleDirectoryUsersBatch(event, uids)
      const rows = envelope.data as Array<{ uid?: unknown, status?: unknown, statusKey?: unknown }>
      const active = new Set(rows
        .filter(row => text(row.statusKey || row.status) === 'active' || text(row.status) === '1')
        .map(row => text(row.uid)))
      return uids.filter(candidate => active.has(candidate))
    },
    publish: recipients => publishPortalNotification(
      {
        sourceAppCode: 'console',
        eventType: phase.eventType,
        category: 'authorization_lifecycle',
        severity: 'error',
        title: phase.title,
        summary: phase.summary,
        body: `员工 ${uid || '-'} 的生命周期授权处理需要人工复核：${message}`,
        actionUrl: buildLifecycleOperationLogActionUrl(phase, idempotencyKey),
        bizType: 'people_lifecycle_authorization',
        bizId: uid,
        idempotencyKey: `people:lifecycle:${input.phase}:${uid}:${idempotencyKey || 'no-idempotency-key'}`,
        recipients,
        metadata: {
          authorizationDescriptor: {
            resource: 'people_lifecycle_authorization',
            id: uid
          },
          uid,
          phase: input.phase,
          sourceApp: text(input.sourceApp) || 'people',
          error: message,
          idempotencyKey,
          operationLog: {
            sourceApp: 'directory',
            action: phase.operationAction,
            requestId: idempotencyKey || null
          },
          retry
        }
      },
      { actorId: 'console-directory-runtime', appCode: 'console' },
      event
    ),
    warn: (warning, context) => console.warn(warning, { uid, phase: input.phase, ...context })
  })

  if (!delivery.ok) return { ...delivery, retry }
  return {
    ok: true,
    delivery: delivery.delivery,
    recipientSource: delivery.recipientSource,
    notificationId: delivery.published.notificationId,
    recipients: delivery.published.recipients,
    retry
  }
}
