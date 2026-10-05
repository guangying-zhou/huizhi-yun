import { productFeedbackRuntimeError } from './productFeedbackRuntimeError'
import { validProductFeedbackProgress } from './productFeedbackProgressInput'
import { createError, getHeader, getQuery, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { hashServiceCommandPayload, maybeCallTenantRuntime, verifyServiceCommandRuntimeHeaders } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductFeedbackProgressAuth } from './productFeedbackProgressAuth'

export async function handleProductFeedbackProgressService(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'POST') throw createError({ statusCode: 405, message: 'POST required' })
  const binding = await requireProductFeedbackProgressAuth(event)
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '反馈服务不接受查询参数' })
  const body = await readBody(event)
  const envelope = body?.serviceCommand, command = envelope?.command
  const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) && value !== '00000000-0000-0000-0000-000000000000'
  const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.isWellFormed() && value.length > 0 && value === value.trim() && [...value].length <= max && !/\p{Cc}/u.test(value)
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !command || typeof command !== 'object' || Array.isArray(command) || !validProductFeedbackProgress(command) || !text(command.productCode, 64) || /[/\\]/.test(command.productCode) || !text(command.ticketCode, 30) || /[/\\]/.test(command.ticketCode) || !uuid(command.requestBizId) || !uuid(command.canonicalRequestBizId) || !['submitted', 'evaluating', 'accepted', 'deferred', 'rejected', 'merged'].includes(command.decisionStatus) || (command.decisionStatus === 'merged') !== (command.requestBizId !== command.canonicalRequestBizId) || !Number.isSafeInteger(command.sourceRevision) || command.sourceRevision <= 0 || envelope.targetApp !== 'altoc' || envelope.operationCode !== 'aims.altoc.product-feedback.update-progress.v1' || envelope.requiredCapability !== 'altoc:product-feedback:update-progress' || envelope.commandSchemaVersion !== 'product-feedback-progress.v1' || !uuid(envelope.operationId) || !text(envelope.idempotencyKey, 191) || envelope.commandSha256 !== await hashServiceCommandPayload(command)) throw createError({ statusCode: 403, message: '反馈签名命令无效' })
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401, message: '缺少服务令牌' })
  await verifyServiceCommandRuntimeHeaders({ token, method: 'POST', requestTarget: getRequestURL(event).pathname, requestId: getHeader(event, 'x-request-id') || '', tenantCode: binding.tenant, sourceDeploymentCode: binding.sourceDeployment, targetDeploymentCode: binding.targetDeployment, sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'altoc', envelope: { operationId: envelope.operationId, targetApp: envelope.targetApp, operationCode: envelope.operationCode, requiredCapability: envelope.requiredCapability, idempotencyKey: envelope.idempotencyKey, commandSchemaVersion: envelope.commandSchemaVersion, commandSha256: envelope.commandSha256 }, readHeader: name => getHeader(event, name) })
  const response = await maybeCallTenantRuntime<{ code: number, data: Record<string, unknown> }>(event, '/v1/altoc/internal/product-feedback:progress', {
    appCode: 'altoc', method: 'POST', scope: 'altoc.write altoc:product-feedback:update-progress',
    serviceTokenSourceBinding: 'service-client-policy', body: { serviceCommand: envelope }
  })
  if (!response.handled) throw createError({ statusCode: 503, message: '产品状态回流运行服务暂不可用' })
  if (response.data.code !== 0) throw productFeedbackRuntimeError(response.data)
  const receipt = response.data.data
  const result = receipt?.result as Record<string, unknown> | undefined
  if (!receipt || !result || !uuid(receipt.receiptId) || receipt.receiptStatus !== 'succeeded' || typeof receipt.idempotent !== 'boolean' || receipt.operationId !== envelope.operationId || receipt.operationCode !== envelope.operationCode || receipt.idempotencyKey !== envelope.idempotencyKey || receipt.commandSchemaVersion !== envelope.commandSchemaVersion || receipt.commandSha256 !== envelope.commandSha256 || receipt.targetBizType !== 'product_feedback' || receipt.targetBizCode !== command.requestBizId || typeof receipt.responseSummarySha256 !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.responseSummarySha256) || result.requestBizId !== command.requestBizId || result.sourceRevision !== command.sourceRevision || typeof result.applied !== 'boolean') throw createError({ statusCode: 503, message: '产品反馈回执不一致' })
  return { code: 0, data: { operationId: receipt.operationId, operationCode: receipt.operationCode, idempotencyKey: receipt.idempotencyKey, commandSchemaVersion: receipt.commandSchemaVersion, commandSha256: receipt.commandSha256, receiptId: receipt.receiptId, receiptStatus: receipt.receiptStatus, idempotent: receipt.idempotent, targetBizType: receipt.targetBizType, targetBizCode: receipt.targetBizCode, responseSummarySha256: receipt.responseSummarySha256, result: { requestBizId: result.requestBizId, sourceRevision: result.sourceRevision, applied: result.applied } } }
}
