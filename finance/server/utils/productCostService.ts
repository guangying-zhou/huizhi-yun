import { productCostRuntimeError } from './productCostRuntimeError'
import { createError, getHeader, getMethod, getQuery, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders, maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductCostServiceAuth, productCostReadCapability } from './productCostServiceAuth'
import { resolveProductCostAuthorization } from './productCostAuthorization'

const operation = 'aims.finance.product-cost.read.v1'
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.isWellFormed() && value.length > 0 && value === value.trim() && [...value].length <= max && !/[\p{Cc}]/u.test(value)

export async function handleProductCostService(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const binding = await requireProductCostServiceAuth(event)
  if (getMethod(event) !== 'POST') throw createError({ statusCode: 405, message: 'POST required' })
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '成本查询不接受 query 参数' })
  const body = await readBody(event)
  const envelope = body?.serviceCommand
  const command = envelope?.command
  if (!body || Object.keys(body).length !== 1 || !envelope || typeof envelope !== 'object'
    || !command || typeof command !== 'object' || Object.keys(command).length !== 5
    || !text(command.actorUid, 64) || command.actorUid === '@all' || command.actorUid.startsWith('client:')
    || !text(command.productCode, 64) || !text(command.projectCode, 50)
    || [command.actorUid, command.productCode, command.projectCode].some(value => /[/\\]/.test(value))
    || command.action !== 'read' || typeof command.periodMonth !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(command.periodMonth) || command.periodMonth.startsWith('0000')
    || envelope.targetApp !== 'finance' || envelope.operationCode !== operation || envelope.commandSchemaVersion !== operation
    || envelope.requiredCapability !== productCostReadCapability || !text(envelope.operationId, 128) || !text(envelope.idempotencyKey, 200)
    || envelope.commandSha256 !== await hashServiceCommandPayload(command)) {
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
  const scopes = await resolveProductCostAuthorization(event, command.actorUid)
  const response = await maybeCallTenantRuntime<{ code: number, data: Record<string, unknown> }>(event, '/v1/finance/internal/product-cost:read', {
    appCode: 'finance', method: 'POST', scope: `finance.read ${productCostReadCapability}`,
    serviceTokenSourceBinding: 'service-client-policy', serviceCommandActor: { uid: command.actorUid },
    body: { serviceCommand: envelope, productCostAuthorization: { ...scopes, expiresAt: Date.now() + 15000 } }
  })
  if (!response.handled) throw createError({ statusCode: 503, message: '产品成本运行服务暂不可用' })
  if (response.data.code !== 0) throw productCostRuntimeError(response.data)
  const result = response.data.data
  if (!result || result.productCode !== command.productCode || result.projectCode !== command.projectCode || result.periodMonth !== command.periodMonth
    || typeof result.ready !== 'boolean' || !Array.isArray(result.reasons) || !result.reasons.every(reason => typeof reason === 'string')
    || !Number.isSafeInteger(result.ruleRevision) || Number(result.ruleRevision) < 0
    || typeof result.sourceRevision !== 'string' || !/^[0-9a-f]{64}$/.test(result.sourceRevision)
    || !(result.basisPoints === null || (Number.isSafeInteger(result.basisPoints) && Number(result.basisPoints) > 0 && Number(result.basisPoints) <= 10000))
    || !Array.isArray(result.costs) || !result.costs.every(cost => cost && typeof cost === 'object' && typeof cost.currencyCode === 'string' && typeof cost.amount === 'string' && /^[A-Z]{3}$/.test(cost.currencyCode) && /^(0|[1-9][0-9]{0,15})\.[0-9]{2}$/.test(cost.amount))
    || new Set(result.costs.map(cost => cost.currencyCode)).size !== result.costs.length
    || (result.ready ? result.reasons.length !== 0 || result.basisPoints === null || result.costs.length === 0 : result.costs.length !== 0 || result.reasons.length === 0)
    || result.costBasis !== 'finance_non_canceled_expense_and_active_allocations_v1'
    || result.revenueReady !== false || result.revenueReason !== 'revenue_attribution_not_configured') {
    throw createError({ statusCode: 503, message: '产品成本查询响应无效' })
  }
  return { code: 0, data: {
    productCode: result.productCode, projectCode: result.projectCode, periodMonth: result.periodMonth,
    ready: result.ready, reasons: result.reasons, ruleRevision: result.ruleRevision, sourceRevision: result.sourceRevision,
    basisPoints: result.basisPoints, costs: result.costs.map(cost => ({ currencyCode: cost.currencyCode, amount: cost.amount })),
    costBasis: result.costBasis, revenueReady: result.revenueReady, revenueReason: result.revenueReason
  } }
}
