import type { H3Event } from 'h3'
import {
  resolveNotificationActionUrl,
  type NotificationActionTargetCatalog
} from '@hzy/foundation/shared/utils/notificationActionUrl'

export interface RuntimeNotification {
  touser?: string[] | string
  title?: string
  description?: string
  url?: string
  eventType?: string
  category?: string
  severity?: 'info' | 'success' | 'warning' | 'error'
  bizType?: string
  bizId?: string | number
  eventVersion?: string
  idempotencyKey?: string
  metadata?: Record<string, unknown>
}

export interface WorkflowNotificationRequest {
  touser: string[]
  title: string
  description: string
  url: string
  sourceAppCode: 'workflow'
  eventType: string
  category: string
  severity: 'info' | 'success' | 'warning' | 'error'
  bizType: string
  bizId: string | number
  idempotencyKey: string
  metadata?: Record<string, unknown>
  event: H3Event
}

export interface WorkflowNotificationDependencies {
  send: (params: WorkflowNotificationRequest) => Promise<unknown>
  error?: (message: string, error: unknown) => void
  loadActionTargetCatalog: (event: H3Event) => Promise<NotificationActionTargetCatalog | null>
  checkEligibility: (input: {
    event: H3Event
    subjectUid: string
    purpose: WorkflowEligibilityPurpose
  }) => Promise<{ active: boolean, allowed: boolean, reason: string }>
}

export type WorkflowEligibilityPurpose = 'task_actionable' | 'instance_actionable' | 'instance_status'

export interface WorkflowNotificationDeliveryResult {
  idempotencyKey: string
  status: 'published' | 'failed' | 'skipped'
  code?: string
}

function notificationUsers(notification: RuntimeNotification) {
  const raw = Array.isArray(notification.touser) ? notification.touser : [notification.touser]
  return [...new Set(raw
    .flatMap(item => String(item || '').split(/[|,\s]+/))
    .map(item => item.trim())
    .filter(Boolean))]
}

const taskActionableEvents = new Set([
  'workflow.task.created',
  'workflow.task.delegated',
  'workflow.instance.resubmitted'
])
const instanceStatusEvents = new Set([
  'workflow.instance.approved',
  'workflow.instance.rejected',
  'workflow.instance.withdrawn'
])

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
}

function workflowTaskIds(value: unknown) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some(item => !positiveInteger(item))) return null
  return [...new Set(value as number[])].sort((left, right) => left - right)
}

function workflowEligibilityContract(eventType: string, metadata: Record<string, unknown>) {
  const instanceId = positiveInteger(metadata.workflowInstanceId)
  const taskIds = workflowTaskIds(metadata.workflowTaskIds)
  if (!instanceId || taskIds === null) return null
  if (taskActionableEvents.has(eventType)) {
    if (taskIds.length === 0) return null
    if (taskIds.length > 1) {
      return {
        purpose: 'instance_actionable' as const,
        fallbackPath: `/workflow/instances/${instanceId}`
      }
    }
    return {
      purpose: 'task_actionable' as const,
      fallbackPath: `/workflow/tasks/${taskIds[0]}`
    }
  }
  if (instanceStatusEvents.has(eventType)) {
    if (eventType !== 'workflow.instance.rejected' && taskIds.length > 0) return null
    return {
      purpose: 'instance_status' as const,
      fallbackPath: `/workflow/instances/${instanceId}`
    }
  }
  return null
}

function boundWorkflowFallback(
  metadata: Record<string, unknown>,
  targetAppCode: string,
  catalog: NotificationActionTargetCatalog,
  fallbackPath: string
) {
  const fallback = resolveNotificationActionUrl({
    actionUrl: fallbackPath,
    actionTargetAppCode: 'workflow',
    sourceAppCode: 'workflow'
  }, catalog.applications, catalog.currentOrigin)
  return fallback
    ? {
        url: fallback,
        metadata: {
          ...metadata,
          businessTargetAppCode: String(metadata.businessTargetAppCode || targetAppCode).trim(),
          actionTargetAppCode: 'workflow',
          urlFallback: true
        }
      }
    : null
}

export async function deliverWorkflowRuntimeNotifications(
  event: H3Event,
  notifications: RuntimeNotification[] = [],
  dependencies: WorkflowNotificationDependencies
) {
  const results: WorkflowNotificationDeliveryResult[] = []
  let catalogPromise: Promise<NotificationActionTargetCatalog | null> | null = null
  const loadCatalog = () => {
    catalogPromise ||= dependencies.loadActionTargetCatalog(event).catch(() => null)
    return catalogPromise
  }
  for (const notification of notifications) {
    const users = notificationUsers(notification)
    if (users.length === 0) {
      results.push({ idempotencyKey: String(notification.idempotencyKey || ''), status: 'skipped', code: 'recipients_missing' })
      continue
    }

    const eventVersion = String(notification.eventVersion || '').trim()
    const idempotencyKey = String(notification.idempotencyKey || '').trim()
    if (!eventVersion || !idempotencyKey) {
      dependencies.error?.('[WorkflowRuntime] 跳过缺少稳定事件身份的通知', {
        code: 'workflow_notification_identity_missing'
      })
      results.push({ idempotencyKey, status: 'skipped', code: 'workflow_notification_identity_missing' })
      continue
    }

    const eventType = String(notification.eventType || '').trim()
    const category = String(notification.category || '').trim()
    const severity = notification.severity
    const bizType = String(notification.bizType || '').trim()
    const metadataBizId = notification.metadata?.instanceId
    const bizId = notification.bizId
      ?? (typeof metadataBizId === 'string' || typeof metadataBizId === 'number' ? metadataBizId : undefined)
    const targetAppCode = String(notification.metadata?.targetAppCode || '').trim()
    const bizKey = String(notification.metadata?.bizKey || '').trim()
    const actionableKey = String(notification.metadata?.actionableKey || '').trim()
    if (!eventType || !category || !severity || !bizType || bizId === undefined || bizId === null || !notification.metadata || !targetAppCode || !bizKey || !actionableKey) {
      dependencies.error?.('[WorkflowRuntime] 跳过契约不完整的通知', {
        code: 'workflow_notification_contract_invalid'
      })
      results.push({ idempotencyKey, status: 'skipped', code: 'workflow_notification_contract_invalid' })
      continue
    }

    const businessTargetAppCode = String(notification.metadata.businessTargetAppCode || targetAppCode).trim()
    const contract = workflowEligibilityContract(eventType, notification.metadata)
    if (!contract || businessTargetAppCode !== targetAppCode) {
      dependencies.error?.('[WorkflowRuntime] 拒绝未知或矛盾的通知 eligibility 合同', {
        code: 'workflow_notification_eligibility_contract_invalid'
      })
      results.push({ idempotencyKey, status: 'failed', code: 'workflow_notification_eligibility_contract_invalid' })
      continue
    }

    const eligibility = await Promise.allSettled(users.map(async subjectUid => await dependencies.checkEligibility({
      event,
      subjectUid,
      purpose: contract.purpose
    })))
    if (eligibility.some(result => result.status === 'rejected')) {
      dependencies.error?.('[WorkflowRuntime] 收件人 eligibility 服务不可用', {
        code: 'workflow_notification_eligibility_unavailable'
      })
      results.push({ idempotencyKey, status: 'failed', code: 'workflow_notification_eligibility_unavailable' })
      continue
    }
    if (eligibility.some(result => result.status === 'fulfilled' && (!result.value.active || !result.value.allowed))) {
      dependencies.error?.('[WorkflowRuntime] 收件人不满足通知最低查看资格', {
        code: 'workflow_notification_recipient_ineligible'
      })
      results.push({ idempotencyKey, status: 'failed', code: 'workflow_notification_recipient_ineligible' })
      continue
    }

    const title = notification.title || '您有新的审批待办'
    const description = notification.description || ''
    const catalog = await loadCatalog()
    const target = catalog
      ? boundWorkflowFallback(notification.metadata, targetAppCode, catalog, contract.fallbackPath)
      : null
    if (!target) {
      dependencies.error?.('[WorkflowRuntime] 操作目标应用目录不可用或链接不受信任', {
        code: 'workflow_notification_action_target_unavailable'
      })
      results.push({ idempotencyKey, status: 'failed', code: 'workflow_notification_action_target_unavailable' })
      continue
    }
    try {
      await dependencies.send({
        touser: users,
        title,
        description,
        url: target.url,
        sourceAppCode: 'workflow',
        eventType,
        category,
        severity,
        bizType,
        bizId,
        idempotencyKey,
        metadata: { ...target.metadata, eventVersion, sourceApp: 'workflow' },
        event
      })
      results.push({ idempotencyKey, status: 'published' })
    } catch (error) {
      dependencies.error?.('[WorkflowRuntime] 发送通知失败:', error)
      results.push({ idempotencyKey, status: 'failed', code: 'workflow_notification_publish_failed' })
    }
  }
  return results
}
