import { productCostRuntimeError } from './productCostRuntimeError'
import { parseProductCostRulesReadInput, parseProductCostRulesReadResult } from './productCostRulesReadInput'
import { createError, getHeader, getMethod, getQuery, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders, maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductCostRulesReadServiceAuth, productCostRulesReadCapability } from './productCostServiceAuth'
import { resolveProductCostRulesAuthorization } from './productCostAuthorization'

const operation = 'aims.finance.product-cost.rules.read.v1'
const schema = 'product-cost-rules-read.v1'
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.isWellFormed() && value.length > 0 && value === value.trim() && [...value].length <= max && !/[\p{Cc}]/u.test(value)

export async function handleProductCostRulesReadService(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const binding = await requireProductCostRulesReadServiceAuth(event)
  if (getMethod(event) !== 'POST') throw createError({ statusCode: 405, message: 'POST required' })
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '成本查询不接受 query 参数' })
  const body = await readBody(event)
  const envelope = body?.serviceCommand
  const command = parseProductCostRulesReadInput(envelope?.command)
  if (!body || Object.keys(body).length !== 1 || !envelope || typeof envelope !== 'object'
    || !command
    || envelope.targetApp !== 'finance' || envelope.operationCode !== operation || envelope.commandSchemaVersion !== schema
    || envelope.requiredCapability !== productCostRulesReadCapability || !text(envelope.operationId, 128) || !text(envelope.idempotencyKey, 200)
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
  const response = await maybeCallTenantRuntime<{ code: number, data: Record<string, unknown> }>(event, '/v1/finance/internal/product-cost:read-rules', {
    appCode: 'finance', method: 'POST', scope: `finance.read ${productCostRulesReadCapability}`,
    serviceTokenSourceBinding: 'service-client-policy', serviceCommandActor: { uid: command.actorUid },
    body: { serviceCommand: envelope, productCostRulesAuthorization: { ...scopes, action: 'edit', purpose: 'product_cost_rules_edit', expiresAt: Date.now() + 15000 } }
  })
  if (!response.handled) throw createError({ statusCode: 503, message: '产品成本运行服务暂不可用' })
  if (response.data.code !== 0) throw productCostRuntimeError(response.data)
  const data = parseProductCostRulesReadResult(response.data.data, command.projectCode, command.periodMonth)
  if (!data) throw createError({ statusCode: 503, message: '分摊规则读取响应无效' })
  return { code: 0, data }
}
