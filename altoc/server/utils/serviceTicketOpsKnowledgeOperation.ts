import { sendProductFeedback } from './productFeedbackTransport'
import { createError, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { crossAppForwardedHeaders } from '@hzy/foundation/server/utils/crossAppForwardedHeaders'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { requestWithServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import {
  buildServiceCommandEnvelope,
  classifyServiceOperationFailure,
  extractServiceOperationStatus,
  resolveServiceOperationConflictDisposition,
  validateServiceCommandReceipt,
  type ServiceOperationFailure
} from '@hzy/foundation/server/utils/serviceOperation'
import { serviceTicketOpsKnowledgeIdempotencyKey, type RuntimeRow } from './serviceTicketOpsKnowledge'

interface RuntimeEnvelope<T> {
  code?: number | string
  data?: T
  message?: string
}

export interface ClaimedOpsKnowledgeOperation extends RuntimeRow {
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
  originalActorUid?: string | null
  command: RuntimeRow
}

export interface OpsKnowledgeOperationIO {
  callProductFeedback?: (operation: ClaimedOpsKnowledgeOperation, envelope: RuntimeRow) => Promise<RuntimeRow>
  callRuntime: <T>(path: string, body: RuntimeRow) => Promise<T>
  callService: <T>(appCode: 'codocs' | 'assets' | 'aims' | 'finance', scope: string, path: string, body: RuntimeRow, idempotencyKey: string, actorUid?: string) => Promise<T>
}

function text(value: unknown) {
  return String(value || '').trim()
}

function objectBody(value: unknown): RuntimeRow {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as RuntimeRow
  return {}
}

function appendPath(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

async function callServiceApp<T>(
  event: H3Event | null,
  appCode: 'codocs' | 'assets' | 'aims' | 'finance',
  scope: string,
  path: string,
  body: RuntimeRow,
  idempotencyKey: string,
  actorUid?: string
) {
  const baseUrl = resolveServiceAppBaseUrl(event, appCode)
  if (!baseUrl) throw createError({ statusCode: 503, message: `${appCode} service API base URL is not configured.` })
  return await requestWithServiceAccessToken({
    audience: appCode,
    scope,
    event,
    async request(token) {
      const response = await serviceAppFetch<RuntimeEnvelope<T>>(event, appCode, appendPath(baseUrl, path), {
        method: 'POST',
        headers: {
          ...(event ? crossAppForwardedHeaders(event, { idempotencyKey: idempotencyKey }) : { 'idempotency-key': idempotencyKey }),
          'authorization': `Bearer ${token}`,
          'content-type': 'application/json',
          ...(text(actorUid) ? { 'x-hzy-actor-uid': text(actorUid) } : {})
        },
        body,
        timeout: 10000
      })
      if (response.code !== undefined && String(response.code) !== '0') {
        throw createError({ statusCode: 502, message: response.message || `${appCode} service API returned an error.` })
      }
      return response.data as T
    }
  })
}

export function createRequestOpsKnowledgeOperationIO(event: H3Event, query: RuntimeRow): OpsKnowledgeOperationIO {
  return {
    callProductFeedback: (operation, envelope) => sendProductFeedback(event, operation, envelope),
    async callRuntime<T>(path: string, body: RuntimeRow) {
      const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
        appCode: 'altoc',
        scope: 'altoc.write altoc:integration_operation:execute',
        method: 'POST',
        query,
        body
      })
      if (!runtime.handled) throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for reliable delivery.' })
      if (runtime.data.code !== undefined && String(runtime.data.code) !== '0') {
        throw createError({ statusCode: 502, message: runtime.data.message || 'Altoc integration operation failed.' })
      }
      return runtime.data.data as T
    },
    callService: <T>(appCode: 'codocs' | 'assets' | 'aims' | 'finance', scope: string, path: string, body: RuntimeRow, idempotencyKey: string, actorUid?: string) =>
      callServiceApp<T>(event, appCode, scope, path, body, idempotencyKey, actorUid)
  }
}

export function createScheduledOpsKnowledgeOperationIO(
  callRuntime: OpsKnowledgeOperationIO['callRuntime'],
  feedbackTargetDeployment = ''
): OpsKnowledgeOperationIO {
  return {
    callProductFeedback: (operation, envelope) => sendProductFeedback(null, operation, envelope, feedbackTargetDeployment),
    callRuntime,
    callService: <T>(appCode: 'codocs' | 'assets' | 'aims' | 'finance', scope: string, path: string, body: RuntimeRow, idempotencyKey: string, actorUid?: string) =>
      callServiceApp<T>(null, appCode, scope, path, body, idempotencyKey, actorUid)
  }
}

export async function claimOpsKnowledgeOperation(
  io: OpsKnowledgeOperationIO,
  operationKey: string
) {
  return await io.callRuntime<ClaimedOpsKnowledgeOperation | null>(
    `/v1/altoc/integration-operations/${encodeURIComponent(operationKey)}:claim`,
    {}
  )
}

function validateClaimedOperation(operation: ClaimedOpsKnowledgeOperation) {
  const command = objectBody(operation.command)
  const ticketCode = text(command.ticketCode)
  const documentUuid = text(command.documentUuid)
  const idempotencyKey = serviceTicketOpsKnowledgeIdempotencyKey(ticketCode, documentUuid)
  const commonValid = text(operation.sourceApp) === 'altoc'
    && text(operation.idempotencyKey) === idempotencyKey
    && ticketCode !== ''
    && documentUuid !== ''
    && text(command.customerCode) !== ''
    && text(command.contractCode) !== ''
    && text(command.projectCode) !== ''
    && text(command.deliveryCode) !== ''
    && text(command.deliveryAssetCode) !== ''
    && text(command.environmentCode) !== ''
  const codocs = text(operation.operationKey) === `${idempotencyKey}:codocs-link`
    && text(operation.targetApp) === 'codocs'
    && text(operation.operationCode) === 'altoc.ops-knowledge.codocs-link.v1'
    && text(operation.requiredCapability) === 'codocs:documents:write'
  const assets = text(operation.operationKey) === `${idempotencyKey}:assets-link`
    && text(operation.targetApp) === 'assets'
    && text(operation.operationCode) === 'altoc.ops-knowledge.assets-link.v1'
    && text(operation.requiredCapability) === 'assets:write'
  if (!commonValid || (!codocs && !assets)) {
    throw createError({ statusCode: 409, statusMessage: 'integration_operation_identity_mismatch', message: 'Claimed ops knowledge operation is invalid.' })
  }
  return { command, ticketCode, documentUuid, idempotencyKey, target: codocs ? 'codocs' as const : 'assets' as const }
}

function classifyOperationError(error: unknown) {
  const status = extractServiceOperationStatus(error)
  return classifyServiceOperationFailure(error, status === 409
    ? { conflictDisposition: resolveServiceOperationConflictDisposition(error) }
    : {})
}

async function failureCheckpoint(
  io: OpsKnowledgeOperationIO,
  operation: ClaimedOpsKnowledgeOperation,
  failure: ServiceOperationFailure
) {
  return await io.callRuntime<RuntimeRow>(
    `/v1/altoc/integration-operations/${encodeURIComponent(text(operation.operationKey))}:fail`,
    {
      operationId: text(operation.operationId),
      fencingToken: operation.fencingToken,
      httpStatus: failure.statusCode || 0,
      timedOut: failure.timedOut,
      networkError: failure.networkError,
      deliveryUncertain: failure.timedOut || failure.networkError,
      errorCode: failure.code,
      errorSummary: failure.summary,
      ...(failure.conflictDisposition ? { conflictDisposition: failure.conflictDisposition } : {})
    }
  )
}

async function successCheckpoint(
  io: OpsKnowledgeOperationIO,
  operation: ClaimedOpsKnowledgeOperation,
  validated: ReturnType<typeof validateClaimedOperation>,
  actorUid: string,
  receipt: RuntimeRow
) {
  const operationKey = text(operation.operationKey)
  if (validated.target === 'codocs') {
    return await io.callRuntime<RuntimeRow>(
      `/v1/altoc/integration-operations/${encodeURIComponent(operationKey)}:succeed`,
      {
        operationId: text(operation.operationId),
        fencingToken: operation.fencingToken,
        httpStatus: 200,
        targetReceiptId: text(receipt.receiptId),
        receiptOperationId: text(receipt.operationId),
        receiptOperationCode: text(receipt.operationCode),
        receiptIdempotencyKey: text(receipt.idempotencyKey),
        receiptCommandSchemaVersion: text(receipt.commandSchemaVersion),
        receiptCommandSha256: text(receipt.commandSha256),
        targetBizType: text(receipt.targetBizType),
        targetBizCode: text(receipt.targetBizCode),
        responseSummarySha256: text(receipt.responseSummarySha256)
      }
    )
  }
  return await io.callRuntime<RuntimeRow>(
    `/v1/altoc/service-tickets/${encodeURIComponent(validated.ticketCode)}/ops-knowledge:complete`,
    {
      documentUuid: validated.documentUuid,
      operatorUid: actorUid,
      idempotencyKey: validated.idempotencyKey,
      operationId: text(operation.operationId),
      fencingToken: operation.fencingToken,
      targetReceiptId: text(receipt.receiptId),
      receiptOperationId: text(receipt.operationId),
      receiptOperationCode: text(receipt.operationCode),
      receiptIdempotencyKey: text(receipt.idempotencyKey),
      receiptCommandSchemaVersion: text(receipt.commandSchemaVersion),
      receiptCommandSha256: text(receipt.commandSha256),
      targetBizType: text(receipt.targetBizType),
      targetBizCode: text(receipt.targetBizCode),
      responseSummarySha256: text(receipt.responseSummarySha256)
    }
  )
}

export async function executeClaimedOpsKnowledgeOperation(
  operation: ClaimedOpsKnowledgeOperation,
  io: OpsKnowledgeOperationIO
) {
  const operationKey = text(operation.operationKey)
  if (!operationKey || !text(operation.operationId) || !text(operation.fencingToken)) {
    throw createError({ statusCode: 409, message: 'Claimed ops knowledge lease metadata is invalid.' })
  }
  let validated: ReturnType<typeof validateClaimedOperation>
  try {
    validated = validateClaimedOperation(operation)
  } catch (error) {
    const checkpoint = await failureCheckpoint(io, operation, classifyOperationError(error))
    return { succeeded: false, pending: true, target: text(operation.targetApp), checkpoint }
  }

  const { command, documentUuid, idempotencyKey, target } = validated
  const actorUid = text(operation.originalActorUid) || 'altoc.runtime'
  let result: RuntimeRow
  try {
    if (target === 'codocs') {
      const response = await io.callService<RuntimeRow>(
        'codocs',
        'codocs:documents:write',
        '/api/v1/service/ops-knowledge/link',
        buildServiceCommandEnvelope(operation),
        idempotencyKey
      )
      result = validateServiceCommandReceipt(operation, response, {
        targetBizType: 'document',
        targetBizCode: documentUuid
      }) as unknown as RuntimeRow
    } else {
      const response = await io.callService<RuntimeRow>(
        'assets',
        'assets:write',
        `/api/v1/service/deliveries/${encodeURIComponent(text(command.deliveryCode))}/documents`,
        buildServiceCommandEnvelope(operation),
        idempotencyKey
      )
      result = validateServiceCommandReceipt(operation, response, {
        targetBizType: 'delivery_document',
        targetBizCode: documentUuid
      }) as unknown as RuntimeRow
    }
  } catch (error) {
    const failure = classifyOperationError(error)
    const checkpoint = await failureCheckpoint(io, operation, failure)
    return { succeeded: false, pending: true, target, checkpoint }
  }

  const checkpoint = await successCheckpoint(io, operation, validated, actorUid, result)
  return { succeeded: true, pending: false, target, result, checkpoint }
}
