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
  warn?: (message: string, detail: unknown) => void
  loadActionTargetCatalog: (event: H3Event) => Promise<NotificationActionTargetCatalog | null>
  checkEligibility: (input: {
    event: H3Event
    subjectUid: string
    purpose: WorkflowEligibilityPurpose
  }) => Promise<{ active: boolean, allowed: boolean, reason: string }>
  // Test-only override for recordWorkflowResultNotificationPublishFailure's
  // logger; production callers omit it and get the module's console.error
  // default. Kept separate from `error`/`warn` above so this diagnostics-only
  // counter never changes what those existing, contract-tested logs emit.
  logResultNotificationFailure?: (message: string, detail: unknown) => void
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

// "Result" notifications: workflow.instance.approved/withdrawn always, and
// workflow.instance.rejected unless rejectStrategy is to_previous. These are
// exactly the events actionablePrerequisiteNotifications (data-runtime
// actionable_lifecycle.go) excludes from the durable flow_notification_
// outbox, so a failed or skipped in-request publish here is unrecoverable
// without a manual resend.
const resultNotificationEventTypes = new Set([
  'workflow.instance.approved',
  'workflow.instance.withdrawn'
])

function isWorkflowResultNotification(eventType: string, metadata?: Record<string, unknown>) {
  if (resultNotificationEventTypes.has(eventType)) return true
  if (eventType !== 'workflow.instance.rejected') return false
  return String(metadata?.rejectStrategy || '').trim() !== 'to_previous'
}

// In-process only: counts in-request result notification publishes that
// failed or were skipped since this worker/process started. Result
// notifications have no durable outbox (see isWorkflowResultNotification
// above), so a lost publish is unrecoverable without a manual resend; this
// counter exists to keep that loss observable. It does not change delivery
// semantics.
let resultNotificationPublishFailed = 0

export interface WorkflowResultNotificationPublishFailure {
  instanceId?: number
  eventType: string
  causeStatus?: number
  causeClass?: string
  causeCode?: string
}

function safeCauseCode(value: unknown) {
  const code = String(value || '').trim()
  return /^[a-z][a-z0-9_.:-]{2,79}$/.test(code) ? code : ''
}

// Fixed code, instanceId and event/cause identity only: never title, body,
// URL, recipients or tokens.
export function recordWorkflowResultNotificationPublishFailure(
  failure: WorkflowResultNotificationPublishFailure,
  log: (message: string, detail: unknown) => void = (message, detail) => console.error(message, detail)
) {
  resultNotificationPublishFailed += 1
  const causeCode = safeCauseCode(failure.causeCode)
  const causeClass = /^[A-Za-z]{1,40}$/.test(String(failure.causeClass || '')) ? failure.causeClass : ''
  const causeStatus = Number.isInteger(failure.causeStatus) && (failure.causeStatus as number) >= 100 && (failure.causeStatus as number) <= 599
    ? failure.causeStatus
    : undefined
  log('[WorkflowRuntime] 结果类通知发布失败或被跳过，且没有持久 outbox 重试', {
    code: 'workflow_result_notification_publish_failed',
    ...(failure.instanceId ? { instanceId: failure.instanceId } : {}),
    eventType: failure.eventType,
    ...(causeStatus !== undefined ? { causeStatus } : {}),
    ...(causeClass ? { causeClass } : {}),
    ...(causeCode ? { causeCode } : {})
  })
  return resultNotificationPublishFailed
}

export function workflowResultNotificationPublishFailures() {
  return resultNotificationPublishFailed
}

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

type WorkflowActionTargetReason = 'workflow_action_target_host_list_fallback' | 'workflow_action_target_host_not_deployed'

// Mirrors resolveNotificationActionUrl's application selection.
function activeApplication(catalog: NotificationActionTargetCatalog, appCode: string) {
  return catalog.applications.find(app => (
    String(app.appCode || '').trim().toLowerCase() === appCode
    && (!String(app.status || '').trim() || String(app.status).trim().toLowerCase() === 'active')
  ))
}

function boundWorkflowFallback(
  metadata: Record<string, unknown>,
  targetAppCode: string,
  catalog: NotificationActionTargetCatalog,
  fallbackPath: string
): { target: { url: string, metadata: Record<string, unknown> } | null, reason?: WorkflowActionTargetReason } {
  const enterprise = catalog.applications.filter(app => app.appCode === 'enterprise')
  if (enterprise.length > 1) return { target: null }
  const host = enterprise[0]
  const hosted = catalog.source === 'policy_bundle' && host?.status === 'active' && host.deploymentState === 'deployed'
  const bind = (actionTargetAppCode: 'enterprise' | 'workflow', actionUrl: string) => {
    const url = resolveNotificationActionUrl({
      actionUrl,
      actionTargetAppCode,
      sourceAppCode: 'workflow'
    }, catalog.applications, catalog.currentOrigin)
    return url
      ? {
          url,
          metadata: {
            ...metadata,
            businessTargetAppCode: String(metadata.businessTargetAppCode || targetAppCode).trim(),
            actionTargetAppCode,
            urlFallback: true
          }
        }
      : null
  }
  // Only a single-task action has a matching Host detail route.
  const task = /^\/workflow\/tasks\/([1-9]\d*)$/.exec(fallbackPath)
  if (hosted && task) return { target: bind('enterprise', `/enterprise/approvals/${task[1]}`) }

  // Instance, parallel-task and status actions keep the Workflow route
  // contract whenever Workflow itself has a trusted, deployed home.
  const workflowTarget = bind('workflow', fallbackPath)
  const workflowApp = activeApplication(catalog, 'workflow')
  if (workflowTarget && (!hosted || workflowApp?.deploymentState !== 'not-deployed')) return { target: workflowTarget }
  if (!hosted) return { target: null, reason: 'workflow_action_target_host_not_deployed' }
  // Host-only deployment: there is no Host instance detail route, so point to
  // the Host-native approvals list on the verified Enterprise home instead.
  const hostList = bind('enterprise', '/enterprise/approvals')
  return hostList ? { target: hostList, reason: 'workflow_action_target_host_list_fallback' } : { target: null }
}

// HTTP status and error class only: catalog failures may carry Console URLs or
// upstream messages, so neither the message nor a machine code is logged.
export function workflowActionTargetCatalogFailureCause(reason: unknown) {
  const error = (reason || {}) as { statusCode?: unknown, status?: unknown, name?: unknown, response?: { status?: unknown } }
  const status = Number(error.statusCode ?? error.status ?? error.response?.status)
  return {
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { causeStatus: status } : {}),
    ...(typeof error.name === 'string' && /^[A-Za-z]{1,40}$/.test(error.name) ? { causeClass: error.name } : {})
  }
}

// Status and machine code only: eligibility errors are createError codes or
// transport error classes, never request bodies, tokens or recipient data.
function eligibilityFailureCause(reason: unknown) {
  const error = (reason || {}) as { statusCode?: unknown, status?: unknown, message?: unknown, name?: unknown, cause?: { code?: unknown }, data?: { code?: unknown, statusMessage?: unknown } }
  const status = Number(error.statusCode ?? error.status)
  const code = [error.data?.code, error.data?.statusMessage, error.message, error.cause?.code].map(value => String(value || '').trim())
    .find(value => /^[a-z][a-z0-9_.:-]{2,79}$/i.test(value))
  return {
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { causeStatus: status } : {}),
    ...(code ? { causeCode: code } : {}),
    ...(typeof error.name === 'string' && /^[A-Za-z]{1,40}$/.test(error.name) ? { causeClass: error.name } : {})
  }
}

// Counts and logs (via recordWorkflowResultNotificationPublishFailure) every
// non-published outcome for a result-class notification. Never called for
// task-actionable or to_previous-rejected notifications: those are durable
// (flow_notification_outbox) and already retried by the outbox drain.
function recordResultNotificationFailure(
  notification: RuntimeNotification,
  code: string,
  cause: { causeStatus?: number, causeClass?: string, causeCode?: string },
  dependencies: WorkflowNotificationDependencies
) {
  const eventType = String(notification.eventType || '').trim()
  if (!isWorkflowResultNotification(eventType, notification.metadata)) return
  recordWorkflowResultNotificationPublishFailure({
    instanceId: positiveInteger(notification.metadata?.workflowInstanceId),
    eventType,
    causeStatus: cause.causeStatus,
    causeClass: cause.causeClass,
    causeCode: cause.causeCode || code
  }, dependencies.logResultNotificationFailure)
}

export async function deliverWorkflowRuntimeNotifications(
  event: H3Event,
  notifications: RuntimeNotification[] = [],
  dependencies: WorkflowNotificationDependencies
) {
  const results: WorkflowNotificationDeliveryResult[] = []
  let catalogPromise: Promise<NotificationActionTargetCatalog | null> | null = null
  const loadCatalog = () => {
    catalogPromise ||= dependencies.loadActionTargetCatalog(event).then((catalog) => {
      if (!catalog) {
        dependencies.error?.('[WorkflowRuntime] 操作目标应用目录不可用', {
          code: 'workflow_action_target_catalog_unavailable',
          causeCode: 'catalog_missing'
        })
      }
      return catalog
    }, (error: unknown) => {
      dependencies.error?.('[WorkflowRuntime] 操作目标应用目录加载失败', {
        code: 'workflow_action_target_catalog_unavailable',
        ...workflowActionTargetCatalogFailureCause(error)
      })
      return null
    })
    return catalogPromise
  }
  for (const notification of notifications) {
    const users = notificationUsers(notification)
    if (users.length === 0) {
      results.push({ idempotencyKey: String(notification.idempotencyKey || ''), status: 'skipped', code: 'recipients_missing' })
      recordResultNotificationFailure(notification, 'recipients_missing', {}, dependencies)
      continue
    }

    const eventVersion = String(notification.eventVersion || '').trim()
    const idempotencyKey = String(notification.idempotencyKey || '').trim()
    if (!eventVersion || !idempotencyKey) {
      dependencies.error?.('[WorkflowRuntime] 跳过缺少稳定事件身份的通知', {
        code: 'workflow_notification_identity_missing'
      })
      results.push({ idempotencyKey, status: 'skipped', code: 'workflow_notification_identity_missing' })
      recordResultNotificationFailure(notification, 'workflow_notification_identity_missing', {}, dependencies)
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
      recordResultNotificationFailure(notification, 'workflow_notification_contract_invalid', {}, dependencies)
      continue
    }

    const businessTargetAppCode = String(notification.metadata.businessTargetAppCode || targetAppCode).trim()
    const contract = workflowEligibilityContract(eventType, notification.metadata)
    if (!contract || businessTargetAppCode !== targetAppCode) {
      dependencies.error?.('[WorkflowRuntime] 拒绝未知或矛盾的通知 eligibility 合同', {
        code: 'workflow_notification_eligibility_contract_invalid'
      })
      results.push({ idempotencyKey, status: 'failed', code: 'workflow_notification_eligibility_contract_invalid' })
      recordResultNotificationFailure(notification, 'workflow_notification_eligibility_contract_invalid', {}, dependencies)
      continue
    }

    const eligibility = await Promise.allSettled(users.map(async subjectUid => await dependencies.checkEligibility({
      event,
      subjectUid,
      purpose: contract.purpose
    })))
    const rejected = eligibility.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (rejected) {
      const cause = eligibilityFailureCause(rejected.reason)
      dependencies.error?.('[WorkflowRuntime] 收件人 eligibility 服务不可用', {
        code: 'workflow_notification_eligibility_unavailable',
        ...cause
      })
      results.push({ idempotencyKey, status: 'failed', code: 'workflow_notification_eligibility_unavailable' })
      recordResultNotificationFailure(notification, 'workflow_notification_eligibility_unavailable', cause, dependencies)
      continue
    }
    if (eligibility.some(result => result.status === 'fulfilled' && (!result.value.active || !result.value.allowed))) {
      dependencies.error?.('[WorkflowRuntime] 收件人不满足通知最低查看资格', {
        code: 'workflow_notification_recipient_ineligible'
      })
      results.push({ idempotencyKey, status: 'failed', code: 'workflow_notification_recipient_ineligible' })
      recordResultNotificationFailure(notification, 'workflow_notification_recipient_ineligible', {}, dependencies)
      continue
    }

    const title = notification.title || '您有新的审批待办'
    const description = notification.description || ''
    const catalog = await loadCatalog()
    const decision = catalog
      ? boundWorkflowFallback(notification.metadata, targetAppCode, catalog, contract.fallbackPath)
      : { target: null }
    if (decision.reason === 'workflow_action_target_host_list_fallback') {
      const warn = dependencies.warn ?? dependencies.error
      warn?.('[WorkflowRuntime] Workflow 无受信入口，操作目标回退到宿主审批列表', {
        code: decision.reason,
        purpose: contract.purpose
      })
    } else if (decision.reason) {
      dependencies.error?.('[WorkflowRuntime] 宿主未部署且 Workflow 无受信入口', {
        code: decision.reason,
        purpose: contract.purpose
      })
    }
    const target = decision.target
    if (!target) {
      dependencies.error?.('[WorkflowRuntime] 操作目标应用目录不可用或链接不受信任', {
        code: 'workflow_notification_action_target_unavailable'
      })
      results.push({ idempotencyKey, status: 'failed', code: 'workflow_notification_action_target_unavailable' })
      recordResultNotificationFailure(
        notification,
        'workflow_notification_action_target_unavailable',
        decision.reason ? { causeCode: decision.reason } : {},
        dependencies
      )
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
        // Console treats targetAppCode and actionTargetAppCode as one action
        // identity and rejects a mismatch; the business app stays in
        // businessTargetAppCode.
        metadata: {
          ...target.metadata,
          targetAppCode: String(target.metadata.actionTargetAppCode || targetAppCode),
          eventVersion,
          sourceApp: 'workflow'
        },
        event
      })
      results.push({ idempotencyKey, status: 'published' })
    } catch (error) {
      const failure = error as { result?: { inApp?: { reason?: unknown } } } | null
      const cause = eligibilityFailureCause(failure?.result?.inApp?.reason ?? error)
      dependencies.error?.('[WorkflowRuntime] 发送通知失败:', {
        code: 'workflow_notification_publish_failed',
        ...cause
      })
      results.push({ idempotencyKey, status: 'failed', code: 'workflow_notification_publish_failed' })
      recordResultNotificationFailure(notification, 'workflow_notification_publish_failed', cause, dependencies)
    }
  }
  return results
}
