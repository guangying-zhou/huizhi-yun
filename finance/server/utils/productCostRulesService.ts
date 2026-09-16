import { productCostRuntimeError } from './productCostRuntimeError'
import { parseProductCostRulesInput } from './productCostRulesInput'
import { createError, getHeader, getMethod, getQuery, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders, maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductCostRulesServiceAuth, productCostRulesCapability } from './productCostServiceAuth'
import { resolveProductCostRulesAuthorization } from './productCostAuthorization'

const operation = 'aims.finance.product-cost.rules.replace.v1'
const schema = 'product-cost-rules.v1'
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.isWellFormed() && value.length > 0 && value === value.trim() && [...value].length <= max && !/[\p{Cc}]/u.test(value)

export async function handleProductCostRulesService(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const binding = await requireProductCostRulesServiceAuth(event)
  if (getMethod(event) !== 'POST') throw createError({ statusCode: 405, message: 'POST required' })
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '成本查询不接受 query 参数' })
  const body = await readBody(event)
  const envelope = body?.serviceCommand
  const command = parseProductCostRulesInput(envelope?.command)
  if (!body || Object.keys(body).length !== 1 || !envelope || typeof envelope !== 'object'
    || !command
    || envelope.targetApp !== 'finance' || envelope.operationCode !== operation || envelope.commandSchemaVersion !== schema
    || envelope.requiredCapability !== productCostRulesCapability || !text(envelope.operationId, 128) || !text(envelope.idempotencyKey, 200)
    || envelope.commandSha256 !== await hashServiceCommandPayload(envelope.command)) {
    throw createError({ statusCode: 403, message: '产品成本签名命令无效' })
  }
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401, message: '缺少服务令牌' })
  await verifyServiceCommandRuntimeHeaders({
    token, method: 'POST', requestTarget: getRequestURL(event).pathname, requestId: getHeader(event, 'x-request-id') || '',
    tenantCode: binding.tenant, sourceDeploymentCode: binding.sourceDeployment, targetDeploymentCode: binding.targetDeployment,
    sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'finance',
    envelope: { operationId: envelope.operationId, targetApp: envelope.targetApp, operationCode: envelope.operationCode, requiredCapability: envelope.requiredCapability, idempotencyKey: envelope.idempotencyKey, commandSchemaVersion: envelope.commandSchemaVersion, commandSha256: envelope.commandSha256 },
    readHeader: name => getHeader(event, name)
  })
  const scopes = await resolveProductCostRulesAuthorization(event, command.actorUid)
  const response = await maybeCallTenantRuntime<{ code: number, data: Record<string, unknown> }>(event, '/v1/finance/internal/product-cost:replace-rules', {
    appCode: 'finance', method: 'POST', scope: `finance.write ${productCostRulesCapability}`,
    serviceTokenSourceBinding: 'service-client-policy', serviceCommandActor: { uid: command.actorUid },
    body: { serviceCommand: envelope, productCostRulesAuthorization: { ...scopes, action: 'edit', purpose: 'product_cost_rules_edit', expiresAt: Date.now() + 15000 } }
  })
  if (!response.handled) throw createError({ statusCode: 503, message: '产品成本运行服务暂不可用' })
  if (response.data.code !== 0) throw productCostRuntimeError(response.data)
  const receipt = response.data.data
  const value = receipt?.result as Record<string, unknown> | undefined
  if (!receipt || !text(receipt.receiptId, 36) || receipt.receiptStatus !== 'succeeded'
    || receipt.operationId !== envelope.operationId || receipt.operationCode !== operation
    || receipt.idempotencyKey !== envelope.idempotencyKey || receipt.commandSchemaVersion !== schema || receipt.commandSha256 !== envelope.commandSha256
    || receipt.targetBizType !== 'product_cost_attribution_revision' || receipt.targetBizCode !== `${command.projectCode}:${command.periodMonth}:${command.expectedRevision + 1}`
    || typeof receipt.idempotent !== 'boolean' || typeof receipt.responseSummarySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.responseSummarySha256)
    || !value || value.projectCode !== command.projectCode || value.periodMonth !== command.periodMonth || value.revision !== command.expectedRevision + 1) {
    throw createError({ statusCode: 503, message: '分摊规则写入收据无效' })
  }
  return { code: 0, data: {
    receiptId: receipt.receiptId, receiptStatus: receipt.receiptStatus, operationId: receipt.operationId,
    operationCode: receipt.operationCode, idempotencyKey: receipt.idempotencyKey, commandSchemaVersion: receipt.commandSchemaVersion,
    commandSha256: receipt.commandSha256, targetBizType: receipt.targetBizType, targetBizCode: receipt.targetBizCode,
    idempotent: receipt.idempotent, responseSummarySha256: receipt.responseSummarySha256,
    result: { projectCode: value.projectCode, periodMonth: value.periodMonth, revision: value.revision }
  } }
}
