import type { H3Event } from 'h3'
import { createError } from 'h3'
import { createRequestServiceTicketDeliveryOperationIO } from './serviceTicketDeliveryOperation'
import { executeClaimedProductDocumentOperation } from './productDocumentOperationExecutor'
import type { ClaimedDeliveryOperation } from './serviceTicketDeliveryOperationExecutor'

export async function dispatchProductDocumentRequest(event: H3Event, requestBizId: string, productCode: string) {
  const key = `aims:product-document:create:${requestBizId}`
  const io = createRequestServiceTicketDeliveryOperationIO(event)
  const operation = await io.callRuntime<ClaimedDeliveryOperation | null>(`/v1/aims/integration-operations/${encodeURIComponent(key)}:claim`, {})
  if (!operation) return { synced: false, pending: true }
  if (operation.operationKey !== key || operation.idempotencyKey !== key || operation.operationCode !== 'aims.codocs.product-document.create.v1' || operation.command?.productCode !== productCode) throw createError({ statusCode: 409, message: '文档创建任务与产品请求不一致' })
  return await executeClaimedProductDocumentOperation(operation, io)
}
