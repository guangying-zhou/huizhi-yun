import { createError, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { crossAppForwardedHeaders } from '@hzy/foundation/server/utils/crossAppForwardedHeaders'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { requestWithServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { drainIntegrationOperationDeadLetterNotifications } from '@hzy/foundation/server/utils/integrationOperationDeadLetterDrain'
import { publishIntegrationOperationDeadLetter } from '@hzy/foundation/server/utils/notifications'
import {
  buildServiceCommandEnvelope,
  classifyServiceOperationFailure,
  extractServiceOperationStatus,
  resolveServiceOperationConflictDisposition,
  validateServiceCommandReceipt
} from '@hzy/foundation/server/utils/serviceOperation'
import { callFinanceScheduledRuntime, requireFinanceScheduledRuntimeBinding } from './scheduledRuntime'
import { createFinanceDrainBudget } from './integrationOperationDrainBudget'

type Row = Record<string, unknown>
interface RuntimeEnvelope<T> { code?: number | string, data?: T, message?: string }
interface ClaimedOperation extends Row {
  operationId: string
  operationKey: string
  tenantCode: string
  deploymentCode: string
  sourceApp: string
  targetApp: string
  operationCode: string
  requiredCapability: string
  idempotencyKey: string
  commandSchemaVersion: string
  commandSha256: string
  correlationKey?: string
  fencingToken: number | string
  command: Row
}
interface OperationIO {
  callRuntime: <T>(path: string, body: Row) => Promise<T>
  callAltoc: (operation: ClaimedOperation) => Promise<Row>
  callWorkflow: (operation: ClaimedOperation) => Promise<Row>
}

function text(value: unknown) {
  return String(value || '').trim()
}
function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}
function appendPath(baseUrl: string, path: string) {
  const base = baseUrl.replace(/\/+$/, '')
  const normalized = path.replace(/^\/+/, '')
  return base.endsWith('/api/v1') && normalized.startsWith('api/v1/')
    ? `${base}/${normalized.slice('api/v1/'.length)}`
    : `${base}/${normalized}`
}

async function requestRuntime<T>(event: H3Event, path: string, body: Row) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'finance', scope: 'finance.write finance:integration_operation:execute', method: 'POST', body
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: 'Finance tenant-runtime is required for reliable delivery.' })
  if (runtime.data.code !== undefined && String(runtime.data.code) !== '0') throw createError({ statusCode: 502, message: runtime.data.message || 'Finance integration operation failed.' })
  return runtime.data.data as T
}

async function callAltoc(operation: ClaimedOperation, event: H3Event | null) {
  const command = record(operation.command)
  const contractCode = text(command.contractCode)
  const baseUrl = resolveServiceAppBaseUrl(event, 'altoc')
  if (!baseUrl) throw createError({ statusCode: 503, message: 'Altoc service API base URL is not configured.' })
  return await requestWithServiceAccessToken({
    audience: 'altoc', scope: 'altoc:contract:finance-summary:sync', event,
    async request(token) {
      const response = await serviceAppFetch<RuntimeEnvelope<Row>>(
        event,
        'altoc',
        appendPath(baseUrl, `/api/v1/service/contracts/${encodeURIComponent(contractCode)}/finance-summary:sync`),
        {
          method: 'POST',
          headers: {
            ...(event ? crossAppForwardedHeaders(event, { idempotencyKey: text(operation.idempotencyKey) }) : { 'idempotency-key': text(operation.idempotencyKey) }),
            'authorization': `Bearer ${token}`, 'content-type': 'application/json'
          },
          body: buildServiceCommandEnvelope(operation), timeout: 10_000
        }
      )
      if (response.code !== undefined && String(response.code) !== '0') throw createError({ statusCode: 502, message: response.message || 'Altoc finance summary sync failed.' })
      return record(response.data)
    }
  })
}

async function callWorkflow(operation: ClaimedOperation, event: H3Event | null) {
  const command = record(operation.command)
  const actorUid = text(command.actorUid)
  const baseUrl = resolveServiceAppBaseUrl(event, 'workflow')
  if (!baseUrl) throw createError({ statusCode: 503, message: 'Workflow service API base URL is not configured.' })
  return await requestWithServiceAccessToken({
    audience: 'workflow', scope: 'workflow:invoice-request:create', event,
    async request(token) {
      const response = await serviceAppFetch<RuntimeEnvelope<Row>>(event, 'workflow', appendPath(baseUrl, '/api/v1/service/finance-invoice-approval'), {
        method: 'POST',
        headers: {
          ...(event ? crossAppForwardedHeaders(event, { idempotencyKey: text(operation.idempotencyKey) }) : { 'idempotency-key': text(operation.idempotencyKey) }),
          'authorization': `Bearer ${token}`, 'content-type': 'application/json', 'x-hzy-actor-uid': actorUid
        },
        body: buildServiceCommandEnvelope(operation), timeout: 10_000
      })
      if (response.code !== undefined && String(response.code) !== '0') throw createError({ statusCode: 502, message: response.message || 'Workflow invoice approval failed.' })
      return record(response.data)
    }
  })
}

function validateClaim(operation: ClaimedOperation, expectedKey?: string) {
  const command = record(operation.command)
  if (
    (expectedKey && text(operation.operationKey) !== expectedKey)
    || text(operation.sourceApp) !== 'finance'
    || text(operation.targetApp) !== 'altoc'
    || text(operation.operationCode) !== 'finance.reconciliation.altoc-summary.v1'
    || text(operation.requiredCapability) !== 'altoc:contract:finance-summary:sync'
    || text(operation.idempotencyKey) !== text(operation.operationKey)
    || !text(command.contractCode)
    || !text(command.reconciliationCode)
  ) throw createError({ statusCode: 409, statusMessage: 'integration_operation_identity_mismatch', message: 'Claimed Finance Altoc summary operation is invalid.' })
  return command
}

async function checkpointFailure(operation: ClaimedOperation, io: OperationIO, error: unknown) {
  const status = extractServiceOperationStatus(error)
  const failure = classifyServiceOperationFailure(error, status === 409 ? { conflictDisposition: resolveServiceOperationConflictDisposition(error) } : {})
  return await io.callRuntime<Row>(`/v1/finance/integration-operations/${encodeURIComponent(text(operation.operationKey))}:fail`, {
    operationId: text(operation.operationId), fencingToken: operation.fencingToken,
    httpStatus: failure.statusCode || 0, timedOut: failure.timedOut, networkError: failure.networkError,
    deliveryUncertain: failure.timedOut || failure.networkError, errorCode: failure.code, errorSummary: failure.summary,
    ...(failure.conflictDisposition ? { conflictDisposition: failure.conflictDisposition } : {})
  })
}

export async function executeAltocFinanceSummaryOperation(operation: ClaimedOperation, io: OperationIO, expectedKey?: string) {
  let command: Row
  try {
    command = validateClaim(operation, expectedKey)
  } catch (error) {
    return { synced: false, pending: true, operation: await checkpointFailure(operation, io, error) }
  }
  try {
    const response = await io.callAltoc(operation)
    const receipt = validateServiceCommandReceipt(operation, response, { targetBizType: 'contract_finance_summary', targetBizCode: text(command.contractCode) })
    const checkpoint = await io.callRuntime<Row>(`/v1/finance/integration-operations/${encodeURIComponent(text(operation.operationKey))}:succeed`, {
      operationId: text(operation.operationId), fencingToken: operation.fencingToken,
      targetReceiptId: receipt.receiptId, receiptOperationId: receipt.operationId, receiptOperationCode: receipt.operationCode,
      receiptIdempotencyKey: receipt.idempotencyKey, receiptCommandSchemaVersion: receipt.commandSchemaVersion,
      receiptCommandSha256: receipt.commandSha256, targetBizType: receipt.targetBizType, targetBizCode: receipt.targetBizCode,
      responseSummarySha256: receipt.responseSummarySha256
    })
    return { synced: true, pending: false, operation: checkpoint, receipt }
  } catch (error) {
    return { synced: false, pending: true, operation: await checkpointFailure(operation, io, error) }
  }
}

async function executeFinanceWorkflowOperation(operation: ClaimedOperation, io: OperationIO) {
  const command = record(operation.command)
  try {
    if (
      text(operation.sourceApp) !== 'finance' || text(operation.targetApp) !== 'workflow'
      || text(operation.operationCode) !== 'finance.invoice-request.workflow-submit.v1'
      || text(operation.requiredCapability) !== 'workflow:invoice-request:create'
      || text(operation.idempotencyKey) !== text(operation.operationKey)
      || text(command.idempotencyKey) !== text(operation.operationKey)
      || !text(command.invoiceRequestCode) || !text(command.actorUid)
    ) throw createError({ statusCode: 409, statusMessage: 'integration_operation_identity_mismatch', message: 'Claimed Finance Workflow operation is invalid.' })
    const response = await io.callWorkflow(operation)
    if (text(response.targetBizType) !== 'workflow_instance' || !text(response.targetBizCode)) {
      throw createError({ statusCode: 409, message: 'Workflow receipt target is invalid.' })
    }
    const receipt = validateServiceCommandReceipt(operation, response, { targetBizType: 'workflow_instance', targetBizCode: text(response.targetBizCode) })
    const checkpoint = await io.callRuntime<Row>(`/v1/finance/integration-operations/${encodeURIComponent(text(operation.operationKey))}:succeed`, {
      operationId: text(operation.operationId), fencingToken: operation.fencingToken,
      targetReceiptId: receipt.receiptId, receiptOperationId: receipt.operationId, receiptOperationCode: receipt.operationCode,
      receiptIdempotencyKey: receipt.idempotencyKey, receiptCommandSchemaVersion: receipt.commandSchemaVersion,
      receiptCommandSha256: receipt.commandSha256, targetBizType: receipt.targetBizType, targetBizCode: receipt.targetBizCode,
      responseSummarySha256: receipt.responseSummarySha256
    })
    return { synced: true, pending: false, operation: checkpoint, receipt }
  } catch (error) {
    return { synced: false, pending: true, operation: await checkpointFailure(operation, io, error) }
  }
}

export async function tryDispatchFinanceWorkflowOperation(event: H3Event, operationKey: string) {
  try {
    const io: OperationIO = {
      callRuntime: <T>(path: string, body: Row) => requestRuntime<T>(event, path, body),
      callAltoc: operation => callAltoc(operation, event),
      callWorkflow: operation => callWorkflow(operation, event)
    }
    const operation = await io.callRuntime<ClaimedOperation | null>(`/v1/finance/integration-operations/${encodeURIComponent(operationKey)}:claim`, {})
    if (!operation) return { synced: false, pending: true }
    return await executeFinanceWorkflowOperation(operation, io)
  } catch {
    return { synced: false, pending: true, errorCode: 'integration_dispatch_unavailable' }
  }
}

export async function dispatchAltocFinanceSummaryOperation(event: H3Event, operationKey: string) {
  const io: OperationIO = {
    callRuntime: <T>(path: string, body: Row) => requestRuntime<T>(event, path, body),
    callAltoc: operation => callAltoc(operation, event),
    callWorkflow: operation => callWorkflow(operation, event)
  }
  const operation = await io.callRuntime<ClaimedOperation | null>(`/v1/finance/integration-operations/${encodeURIComponent(operationKey)}:claim`, {})
  if (!operation) return { synced: false, pending: true }
  return await executeAltocFinanceSummaryOperation(operation, io, operationKey)
}

export async function tryDispatchAltocFinanceSummaryOperation(event: H3Event, operationKey: string) {
  try {
    return await dispatchAltocFinanceSummaryOperation(event, operationKey)
  } catch {
    // The Finance mutation and durable operation are already committed. A claim/runtime
    // outage must not make the caller retry the business mutation; scheduled drain owns recovery.
    return { synced: false, pending: true, errorCode: 'integration_dispatch_unavailable' }
  }
}

export function financeIntegrationOperationsEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(text(process.env.HZY_FINANCE_INTEGRATION_OPERATIONS_ENABLED).toLowerCase())
}

export async function drainAltocFinanceSummaryOperations(options: {
  maxClaims?: number
  maxWallTimeMs?: number
  claimReserveMs?: number
  now?: () => number
} = {}) {
  if (!financeIntegrationOperationsEnabled()) return { enabled: false, claimed: 0, succeeded: 0, notificationsPublished: 0, notificationFailures: 0 }
  const binding = requireFinanceScheduledRuntimeBinding()
  const requestId = `finance-altoc-summary-${crypto.randomUUID()}`
  const io: OperationIO = {
    callRuntime: <T>(path: string, body: Row) => callFinanceScheduledRuntime<T>(path, { scope: 'finance.write finance:integration_operation:execute', body: { ...body, requestId } }),
    callAltoc: operation => callAltoc(operation, null),
    callWorkflow: operation => callWorkflow(operation, null)
  }
  const budget = createFinanceDrainBudget({
    maxClaims: options.maxClaims || 20,
    maxWallTimeMs: options.maxWallTimeMs || 45_000,
    claimReserveMs: options.claimReserveMs || 25_000,
    now: options.now
  })
  const notificationResult = await drainIntegrationOperationDeadLetterNotifications('finance', binding, {
    callRuntime: io.callRuntime,
    publish: item => publishIntegrationOperationDeadLetter(item),
    warn: (message, context) => console.warn(`[finance] ${message}`, context)
  })
  let succeeded = 0
  let empty = false
  while (budget.canClaim()) {
    const operation = await io.callRuntime<ClaimedOperation | null>('/v1/finance/integration-operations:claim-next', {})
    if (!operation) {
      empty = true
      break
    }
    if (text(operation.tenantCode) !== binding.tenant || text(operation.deploymentCode) !== binding.deployment) throw new Error('Finance claim escaped scheduled runtime binding.')
    budget.recordClaim()
    const result = text(operation.operationCode) === 'finance.invoice-request.workflow-submit.v1'
      ? await executeFinanceWorkflowOperation(operation, io)
      : await executeAltocFinanceSummaryOperation(operation, io)
    if (result.synced) succeeded += 1
  }
  return {
    enabled: true, claimed: budget.claimed(), succeeded, stoppedBy: budget.stoppedBy(empty),
    notificationsPublished: notificationResult.published, notificationFailures: notificationResult.failures
  }
}

/**
 * Tenant Gateway 唤醒的 drain：finance 的可靠命令重试入口。
 *
 * 与 drainAltocFinanceSummaryOperations 的区别在**绑定来源**，这也是 finance 此前
 * 没有任何重试兜底的原因：
 *
 * - 静态版走 requireFinanceScheduledRuntimeBinding()，要求显式配置 endpoint /
 *   tenant / deployment，且托管模式下还要求专属 Console service client
 *   （clientId + clientSecret）。finance worker 没有这套凭据，所以
 *   HZY_FINANCE_INTEGRATION_OPERATIONS_ENABLED 在生产是 false。
 * - 本版的绑定来自 Tenant Gateway 的签名唤醒请求，runtime 令牌通过 event 的
 *   Console app-identity 交换获得，不需要上述任何静态凭据。
 *
 * 因此本入口**刻意不**受 financeIntegrationOperationsEnabled() 约束——那个开关
 * 关的是静态机制，不是这条路径。网关唤醒本身经过内部 token 与 HMAC 校验
 * （requireTenantGatewaySchedulerRequest），它就是调度决策本身，与 altoc 的
 * drainIntegrationOperationsForEvent 保持一致。
 *
 * 走查 ISSUE-B-025：此前 finance 不在网关 SCHEDULER_APPS 中，即时派发一旦失败
 * （例如 403 trusted_finance_actor_required）就被 catch 吞成 pending，
 * operation 永久停摆且无任何错误记录。
 */
export async function drainFinanceIntegrationOperationsForEvent(
  event: H3Event,
  binding: { tenant: string, deployment: string },
  options: { maxClaims?: number, maxWallTimeMs?: number, claimReserveMs?: number, now?: () => number } = {}
) {
  const io: OperationIO = {
    callRuntime: <T>(path: string, body: Row) => requestRuntime<T>(event, path, body),
    callAltoc: operation => callAltoc(operation, event),
    callWorkflow: operation => callWorkflow(operation, event)
  }
  const budget = createFinanceDrainBudget({
    maxClaims: options.maxClaims || 10,
    maxWallTimeMs: options.maxWallTimeMs || 25_000,
    claimReserveMs: options.claimReserveMs || 12_000,
    now: options.now
  })
  const notificationResult = await drainIntegrationOperationDeadLetterNotifications('finance', binding, {
    callRuntime: io.callRuntime,
    publish: item => publishIntegrationOperationDeadLetter(item, event),
    warn: (message, context) => console.warn(`[finance] ${message}`, context)
  })

  let succeeded = 0
  let empty = false
  while (budget.canClaim()) {
    const operation = await io.callRuntime<ClaimedOperation | null>('/v1/finance/integration-operations:claim-next', {})
    if (!operation) {
      empty = true
      break
    }
    // 领取结果必须落在本次网关唤醒的租户/部署绑定内，避免串租户执行。
    if (text(operation.tenantCode) !== binding.tenant || text(operation.deploymentCode) !== binding.deployment) {
      throw createError({ statusCode: 500, message: 'Finance claim escaped the trusted Tenant Gateway binding.' })
    }
    budget.recordClaim()
    const result = text(operation.operationCode) === 'finance.invoice-request.workflow-submit.v1'
      ? await executeFinanceWorkflowOperation(operation, io)
      : await executeAltocFinanceSummaryOperation(operation, io)
    if (result.synced) succeeded += 1
  }

  return {
    claimed: budget.claimed(),
    succeeded,
    stoppedBy: budget.stoppedBy(empty),
    notificationsPublished: notificationResult.published,
    notificationFailures: notificationResult.failures
  }
}
