import { createError, getHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestWithServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { buildServiceCommandEnvelope, classifyServiceOperationFailure, extractServiceOperationStatus, resolveServiceOperationConflictDisposition, validateServiceCommandReceipt } from '@hzy/foundation/server/utils/serviceOperation'
import { drainIntegrationOperationDeadLetterNotifications } from '@hzy/foundation/server/utils/integrationOperationDeadLetterDrain'
import { publishIntegrationOperationDeadLetter } from '@hzy/foundation/server/utils/notifications'
import { callAssetsScheduledRuntime, requireAssetsScheduledRuntimeBinding } from './scheduledRuntime'
import { createAssetsDrainBudget } from './integrationOperationDrainBudget'

type Row = Record<string, unknown>
interface Envelope<T> { code?: number | string, data?: T, message?: string }
interface Operation extends Row { operationId: string, operationKey: string, tenantCode: string, deploymentCode: string, sourceApp: string, targetApp: string, operationCode: string, requiredCapability: string, idempotencyKey: string, commandSchemaVersion: string, commandSha256: string, fencingToken: number | string, command: Row }
interface IO { callRuntime: <T>(path: string, body: Row) => Promise<T>, callAltoc: (operation: Operation) => Promise<Row> }

function text(value: unknown) {
  return String(value || '').trim()
}
function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}
function append(base: string, path: string) {
  const root = base.replace(/\/+$/, '')
  const normalized = path.replace(/^\/+/, '')
  return root.endsWith('/api/v1') && normalized.startsWith('api/v1/') ? `${root}/${normalized.slice(7)}` : `${root}/${normalized}`
}
function contextHeaders(event: H3Event, key: string) {
  const headers: Record<string, string> = { 'idempotency-key': key }
  for (const name of ['x-hzy-gateway', 'x-hzy-gateway-token', 'x-hzy-tenant', 'x-hzy-deployment', 'x-hzy-environment']) {
    const value = text(getHeader(event, name))
    if (value) headers[name] = value
  }
  const requestId = text(getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id'))
  if (requestId) headers['x-request-id'] = requestId
  return headers
}
async function requestRuntime<T>(event: H3Event, path: string, body: Row) {
  const runtime = await maybeCallTenantRuntime<Envelope<T>>(event, path, { appCode: 'assets', scope: 'assets.write assets:integration_operation:execute', method: 'POST', body })
  if (!runtime.handled) throw createError({ statusCode: 503, message: 'Assets tenant-runtime is required for reliable delivery.' })
  if (runtime.data.code !== undefined && String(runtime.data.code) !== '0') throw createError({ statusCode: 502, message: runtime.data.message || 'Assets integration operation failed.' })
  return runtime.data.data as T
}
async function callAltoc(operation: Operation, event: H3Event | null) {
  const command = record(operation.command)
  const assetCode = text(command.deliveryAssetCode)
  const baseUrl = resolveServiceAppBaseUrl(event, 'altoc')
  if (!baseUrl) throw createError({ statusCode: 503, message: 'Altoc service base URL is not configured.' })
  return await requestWithServiceAccessToken({ audience: 'altoc', scope: 'altoc:contract:delivery-asset-status:sync', event, async request(token) {
    const response = await $fetch<Envelope<Row>>(append(baseUrl, `/api/v1/service/customer-delivery-assets/${encodeURIComponent(assetCode)}/status:sync`), {
      method: 'POST', headers: { ...(event ? contextHeaders(event, text(operation.idempotencyKey)) : { 'idempotency-key': text(operation.idempotencyKey) }), 'authorization': `Bearer ${token}`, 'content-type': 'application/json' }, body: buildServiceCommandEnvelope(operation), timeout: 10_000
    })
    if (response.code !== undefined && String(response.code) !== '0') throw createError({ statusCode: 502, message: response.message || 'Altoc delivery status sync failed.' })
    return record(response.data)
  } })
}
function validate(operation: Operation, expectedKey?: string) {
  const command = record(operation.command)
  if ((expectedKey && text(operation.operationKey) !== expectedKey) || text(operation.sourceApp) !== 'assets' || text(operation.targetApp) !== 'altoc' || text(operation.operationCode) !== 'assets.delivery-asset.status-sync.v1' || text(operation.requiredCapability) !== 'altoc:contract:delivery-asset-status:sync' || text(operation.idempotencyKey) !== text(operation.operationKey) || !text(command.deliveryAssetCode) || !text(command.status)) throw createError({ statusCode: 409, statusMessage: 'integration_operation_identity_mismatch', message: 'Claimed Assets status operation is invalid.' })
  return command
}
async function fail(operation: Operation, io: IO, error: unknown) {
  const status = extractServiceOperationStatus(error)
  const failure = classifyServiceOperationFailure(error, status === 409 ? { conflictDisposition: resolveServiceOperationConflictDisposition(error) } : {})
  return await io.callRuntime<Row>(`/v1/assets/integration-operations/${encodeURIComponent(text(operation.operationKey))}:fail`, { operationId: text(operation.operationId), fencingToken: operation.fencingToken, httpStatus: failure.statusCode || 0, timedOut: failure.timedOut, networkError: failure.networkError, deliveryUncertain: failure.timedOut || failure.networkError, errorCode: failure.code, errorSummary: failure.summary, ...(failure.conflictDisposition ? { conflictDisposition: failure.conflictDisposition } : {}) })
}
export async function executeDeliveryAssetStatusOperation(operation: Operation, io: IO, expectedKey?: string) {
  let command: Row
  try {
    command = validate(operation, expectedKey)
  } catch (error) {
    return { synced: false, pending: true, operation: await fail(operation, io, error) }
  }
  try {
    const response = await io.callAltoc(operation)
    const targetCode = `${text(command.deliveryAssetCode)}:revision:${text(command.sourceRevision)}`
    const receipt = validateServiceCommandReceipt(operation, response, { targetBizType: 'contract_delivery_asset_status', targetBizCode: targetCode })
    const checkpoint = await io.callRuntime<Row>(`/v1/assets/integration-operations/${encodeURIComponent(text(operation.operationKey))}:succeed`, { operationId: text(operation.operationId), fencingToken: operation.fencingToken, targetReceiptId: receipt.receiptId, receiptOperationId: receipt.operationId, receiptOperationCode: receipt.operationCode, receiptIdempotencyKey: receipt.idempotencyKey, receiptCommandSchemaVersion: receipt.commandSchemaVersion, receiptCommandSha256: receipt.commandSha256, targetBizType: receipt.targetBizType, targetBizCode: receipt.targetBizCode, responseSummarySha256: receipt.responseSummarySha256 })
    return { synced: true, pending: false, operation: checkpoint, receipt }
  } catch (error) {
    return { synced: false, pending: true, operation: await fail(operation, io, error) }
  }
}
export async function tryDispatchDeliveryAssetStatusOperation(event: H3Event, key: string) {
  try {
    const io: IO = { callRuntime: <T>(path: string, body: Row) => requestRuntime<T>(event, path, body), callAltoc: operation => callAltoc(operation, event) }
    const operation = await io.callRuntime<Operation | null>(`/v1/assets/integration-operations/${encodeURIComponent(key)}:claim`, {})
    return operation ? await executeDeliveryAssetStatusOperation(operation, io, key) : { synced: false, pending: true }
  } catch {
    return { synced: false, pending: true, errorCode: 'integration_dispatch_unavailable' }
  }
}
export function assetsStatusOperationsEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(text(process.env.HZY_ASSETS_STATUS_OPERATIONS_ENABLED).toLowerCase())
}
export async function drainDeliveryAssetStatusOperations(options: { maxClaims?: number, maxWallTimeMs?: number, claimReserveMs?: number, now?: () => number } = {}) {
  if (!assetsStatusOperationsEnabled()) return { enabled: false, claimed: 0, succeeded: 0 }
  const binding = requireAssetsScheduledRuntimeBinding()
  const requestId = `assets-status-${crypto.randomUUID()}`
  const io: IO = { callRuntime: <T>(path: string, body: Row) => callAssetsScheduledRuntime<T>(path, { scope: 'assets.write assets:integration_operation:execute', body, requestId }), callAltoc: operation => callAltoc(operation, null) }
  const notifications = await drainIntegrationOperationDeadLetterNotifications('assets', binding, {
    callRuntime: io.callRuntime,
    publish: item => publishIntegrationOperationDeadLetter(item, null),
    warn: (message, context) => console.warn(`[assets] ${message}`, context)
  })
  const budget = createAssetsDrainBudget({ maxClaims: options.maxClaims || 20, maxWallTimeMs: options.maxWallTimeMs || 45_000, claimReserveMs: options.claimReserveMs || 25_000, now: options.now })
  let succeeded = 0
  let empty = false
  while (budget.canClaim()) {
    const operation = await io.callRuntime<Operation | null>('/v1/assets/integration-operations:claim-next', {})
    if (!operation) {
      empty = true
      break
    }
    if (text(operation.tenantCode) !== binding.tenant || text(operation.deploymentCode) !== binding.deployment) throw new Error('Assets claim escaped scheduled binding.')
    budget.recordClaim()
    if ((await executeDeliveryAssetStatusOperation(operation, io)).synced) succeeded += 1
  }
  return {
    enabled: true,
    claimed: budget.claimed(),
    succeeded,
    stoppedBy: budget.stoppedBy(empty),
    notificationsPublished: notifications.published,
    notificationsClosed: notifications.closed,
    notificationFailures: notifications.failures
  }
}
