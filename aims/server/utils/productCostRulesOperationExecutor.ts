import { createError } from 'h3'
import { buildServiceCommandEnvelope, validateServiceCommandReceipt, classifyServiceOperationFailure, extractServiceOperationStatus, resolveServiceOperationConflictDisposition } from '@hzy/foundation/server/utils/serviceOperation'
import { hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import type { ClaimedDeliveryOperation, RuntimeRow, ServiceTicketDeliveryOperationIO } from './serviceTicketDeliveryOperationExecutor'

export interface ProductCostRulesOperationIO extends ServiceTicketDeliveryOperationIO {
  callFinanceProductCostRules: (envelope: RuntimeRow, operation: ClaimedDeliveryOperation) => Promise<RuntimeRow>
}

export async function executeClaimedProductCostRulesOperation(operation: ClaimedDeliveryOperation, io: ServiceTicketDeliveryOperationIO) {
  const key = operation.operationKey
  if (!key || !operation.operationId || !Number.isSafeInteger(Number(operation.fencingToken)) || Number(operation.fencingToken) < 1) throw createError({ statusCode: 409, message: '分摊规则保存操作租约无效' })
  let receipt
  try {
    const c = operation.command
    if (operation.sourceApp !== 'aims' || operation.targetApp !== 'finance' || operation.operationCode !== 'aims.finance.product-cost.rules.replace.v1' || operation.requiredCapability !== 'finance:product-cost:replace-rules' || operation.commandSchemaVersion !== 'product-cost-rules.v1' || operation.idempotencyKey !== key || !operation.tenantCode || !operation.deploymentCode || !c || Object.keys(c).length !== 6 || typeof c.actorUid !== 'string' || !c.actorUid || typeof c.projectCode !== 'string' || !c.projectCode || typeof c.periodMonth !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(c.periodMonth) || !Number.isSafeInteger(c.expectedRevision) || Number(c.expectedRevision) < 0 || Number(c.expectedRevision) >= Number.MAX_SAFE_INTEGER || typeof c.evidenceRef !== 'string' || !c.evidenceRef.trim() || !Array.isArray(c.shares) || await hashServiceCommandPayload(c) !== operation.commandSha256) throw createError({ statusCode: 409, message: '分摊规则保存冻结命令无效' })
    if (!io.callFinanceProductCostRules) throw createError({ statusCode: 503, message: '分摊规则保存投递通道暂不可用' })
    const response = await io.callFinanceProductCostRules(buildServiceCommandEnvelope(operation), operation)
    receipt = validateServiceCommandReceipt(operation, response, { targetBizType: 'product_cost_attribution_revision', targetBizCode: `${c.projectCode}:${c.periodMonth}:${Number(c.expectedRevision) + 1}` })
    const value = response.result as RuntimeRow | undefined
    if (!value || value.projectCode !== c.projectCode || value.periodMonth !== c.periodMonth || value.revision !== Number(c.expectedRevision) + 1) throw createError({ statusCode: 409, message: '分摊规则保存回执结果不一致' })
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
