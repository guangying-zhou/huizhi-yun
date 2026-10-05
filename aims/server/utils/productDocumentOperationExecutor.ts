import { createError } from 'h3'
import { buildServiceCommandEnvelope, validateServiceCommandReceipt, classifyServiceOperationFailure, extractServiceOperationStatus, resolveServiceOperationConflictDisposition } from '@hzy/foundation/server/utils/serviceOperation'
import { hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import type { ClaimedDeliveryOperation, RuntimeRow, ServiceTicketDeliveryOperationIO } from './serviceTicketDeliveryOperationExecutor'

export interface ProductDocumentOperationIO extends ServiceTicketDeliveryOperationIO {
  callCodocsProductDocument: (envelope: RuntimeRow, operation: ClaimedDeliveryOperation) => Promise<RuntimeRow>
}

export async function executeClaimedProductDocumentOperation(operation: ClaimedDeliveryOperation, io: ServiceTicketDeliveryOperationIO) {
  const key = operation.operationKey
  if (!key || !operation.operationId || !Number.isSafeInteger(Number(operation.fencingToken)) || Number(operation.fencingToken) < 1) throw createError({ statusCode: 409, message: '文档创建操作租约无效' })
  let receipt
  try {
    const c = operation.command
    if (operation.sourceApp !== 'aims' || operation.targetApp !== 'codocs' || operation.operationCode !== 'aims.codocs.product-document.create.v1' || operation.requiredCapability !== 'codocs:product-document:create' || operation.commandSchemaVersion !== 'product-document-create.v1' || operation.idempotencyKey !== key || !operation.tenantCode || !operation.deploymentCode || !c || Object.keys(c).length !== 6 || c.action !== 'create' || typeof c.actorUid !== 'string' || !c.actorUid || typeof c.productCode !== 'string' || !c.productCode || typeof c.documentUuid !== 'string' || typeof c.templateUuid !== 'string' || typeof c.title !== 'string' || await hashServiceCommandPayload(c) !== operation.commandSha256) throw createError({ statusCode: 409, message: '文档创建冻结命令无效' })
    if (!io.callCodocsProductDocument) throw createError({ statusCode: 503, message: '文档创建投递通道暂不可用' })
    const response = await io.callCodocsProductDocument(buildServiceCommandEnvelope(operation), operation)
    receipt = validateServiceCommandReceipt(operation, response, { targetBizType: 'product_document', targetBizCode: c.documentUuid })
    const value = response.result as RuntimeRow | undefined
    if (!value || value.uuid !== c.documentUuid || value.productCode !== c.productCode || value.title !== c.title) throw createError({ statusCode: 409, message: '文档创建回执结果不一致' })
  } catch (error) {
    const failure = classifyServiceOperationFailure(error, extractServiceOperationStatus(error) === 409 ? { conflictDisposition: resolveServiceOperationConflictDisposition(error) } : {})
    const checkpoint = await io.callRuntime<RuntimeRow>(`/v1/aims/integration-operations/${encodeURIComponent(key)}:fail`, {
      operationId: operation.operationId, fencingToken: operation.fencingToken, httpStatus: failure.statusCode || 0,
      timedOut: failure.timedOut, networkError: failure.networkError, deliveryUncertain: failure.timedOut || failure.networkError,
      errorCode: failure.code, errorSummary: failure.summary, ...(failure.conflictDisposition ? { conflictDisposition: failure.conflictDisposition } : {})
    })
    return { synced: false, pending: true, operation: checkpoint }
  }
  try {
    const checkpoint = await io.callRuntime<RuntimeRow>(`/v1/aims/integration-operations/${encodeURIComponent(key)}:succeed`, {
      operationId: operation.operationId, fencingToken: operation.fencingToken, httpStatus: 200,
      targetReceiptId: receipt.receiptId, receiptOperationId: receipt.operationId, receiptOperationCode: receipt.operationCode,
      receiptIdempotencyKey: receipt.idempotencyKey, receiptCommandSchemaVersion: receipt.commandSchemaVersion,
      receiptCommandSha256: receipt.commandSha256, targetBizType: receipt.targetBizType, targetBizCode: receipt.targetBizCode,
      responseSummarySha256: receipt.responseSummarySha256
    })
    return { synced: true, pending: false, operation: checkpoint }
  } catch {
    return { synced: false, pending: true, operation: null, errorCode: 'integration_checkpoint_unavailable' }
  }
}
