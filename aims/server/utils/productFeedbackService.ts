import { createError, getHeader, getQuery, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { hashServiceCommandPayload, maybeCallTenantRuntime, verifyServiceCommandRuntimeHeaders } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductFeedbackServiceAuth } from './productFeedbackServiceAuth'
import { requireProductFeedbackAuthorization } from './productFeedbackAuthorization'
import type { ProductAuthorizationFacts } from './productAuthorizationCore'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductFeedbackService(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'POST') throw createError({ statusCode: 405, message: 'POST required' })
  const binding = await requireProductFeedbackServiceAuth(event)
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '反馈服务不接受查询参数' })
  const body = await readBody(event)
  const envelope = body?.serviceCommand, command = envelope?.command
  const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) && value !== '00000000-0000-0000-0000-000000000000'
  const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.isWellFormed() && value.length > 0 && value === value.trim() && [...value].length <= max && !/\p{Cc}/u.test(value)
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !command || typeof command !== 'object' || Array.isArray(command) || Object.keys(command).length !== 7 || !text(command.actorUid, 64) || !text(command.productCode, 64) || /[/\\]/.test(command.productCode) || !text(command.ticketCode, 30) || /[/\\]/.test(command.ticketCode) || !uuid(command.requestBizId) || !text(command.title, 200) || typeof command.description !== 'string' || !command.description.isWellFormed() || [...command.description].length > 10000 || command.description.includes('\0') || command.action !== 'create' || envelope.targetApp !== 'aims' || envelope.operationCode !== 'altoc.aims.product-request.create-from-feedback.v1' || envelope.requiredCapability !== 'aims:product-request:create-from-feedback' || envelope.commandSchemaVersion !== 'product-feedback-create.v1' || !uuid(envelope.operationId) || !text(envelope.idempotencyKey, 191) || envelope.commandSha256 !== await hashServiceCommandPayload(command)) throw createError({ statusCode: 403, message: '反馈签名命令无效' })
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401, message: '缺少服务令牌' })
  await verifyServiceCommandRuntimeHeaders({ token, method: 'POST', requestTarget: getRequestURL(event).pathname, requestId: getHeader(event, 'x-request-id') || '', tenantCode: binding.tenant, sourceDeploymentCode: binding.sourceDeployment, targetDeploymentCode: binding.targetDeployment, sourceApp: 'altoc', sourceClientId: 'altoc.runtime', targetApp: 'aims', envelope: { operationId: envelope.operationId, targetApp: envelope.targetApp, operationCode: envelope.operationCode, requiredCapability: envelope.requiredCapability, idempotencyKey: envelope.idempotencyKey, commandSchemaVersion: envelope.commandSchemaVersion, commandSha256: envelope.commandSha256 }, readHeader: name => getHeader(event, name) })
  const call = async <T>(suffix: string, extra: Record<string, unknown> = {}) => {
    const response = await maybeCallTenantRuntime<{ code: number, data: T }>(event, `/v1/aims/internal/product-requests:${suffix}`, {
      appCode: 'aims', method: 'POST', scope: 'aims.write aims:product-request:create-from-feedback', serviceTokenSourceBinding: 'service-client-policy', serviceCommandActor: { uid: command.actorUid }, body: { serviceCommand: envelope, ...extra }
    })
    if (!response.handled) throw createError({ statusCode: 503, message: '产品反馈运行服务暂不可用' })
    if (response.data.code !== 0) throw runtimeEnvelopeError(response.data)
    return response.data.data
  }
  const facts = await call<ProductAuthorizationFacts>('feedback-authorization')
  const authorization = await requireProductFeedbackAuthorization(event, command.actorUid, command.productCode, facts)
  const receipt = await call<Record<string, unknown>>('from-feedback', { authorization })
  const result = receipt?.result as Record<string, unknown> | undefined
  if (!receipt || !result || !uuid(receipt.receiptId) || receipt.receiptStatus !== 'succeeded' || typeof receipt.idempotent !== 'boolean' || receipt.operationId !== envelope.operationId || receipt.operationCode !== envelope.operationCode || receipt.idempotencyKey !== envelope.idempotencyKey || receipt.commandSchemaVersion !== envelope.commandSchemaVersion || receipt.commandSha256 !== envelope.commandSha256 || receipt.targetBizType !== 'product_request' || receipt.targetBizCode !== command.requestBizId || typeof receipt.responseSummarySha256 !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.responseSummarySha256) || result?.biz_id !== command.requestBizId || result?.product_code !== command.productCode) throw createError({ statusCode: 503, message: '产品反馈回执不一致' })
  return { code: 0, data: { operationId: receipt.operationId, operationCode: receipt.operationCode, idempotencyKey: receipt.idempotencyKey, commandSchemaVersion: receipt.commandSchemaVersion, commandSha256: receipt.commandSha256, receiptId: receipt.receiptId, receiptStatus: receipt.receiptStatus, idempotent: receipt.idempotent, targetBizType: receipt.targetBizType, targetBizCode: receipt.targetBizCode, responseSummarySha256: receipt.responseSummarySha256, result: { biz_id: result.biz_id, product_code: result.product_code } } }
}
