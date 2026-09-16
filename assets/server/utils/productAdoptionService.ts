import { createError, getHeader, getMethod, getQuery, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders, maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductAdoptionServiceAuth, productAdoptionReadCapability } from './productAdoptionServiceAuth'
import { resolveProductAdoptionAuthorization } from './productAdoptionAuthorization'

const operation = 'aims.assets.product-adoption.read.v1'
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.isWellFormed() && value.length > 0 && value === value.trim() && [...value].length <= max && !/[\p{Cc}]/u.test(value)

export async function handleProductAdoptionService(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const binding = await requireProductAdoptionServiceAuth(event)
  if (getMethod(event) !== 'POST') throw createError({ statusCode: 405, message: 'POST required' })
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '采用查询不接受 query 参数' })
  const body = await readBody(event)
  const envelope = body?.serviceCommand
  const command = envelope?.command
  if (!body || Object.keys(body).length !== 1 || !envelope || typeof envelope !== 'object'
    || !command || typeof command !== 'object' || Object.keys(command).length !== 5
    || !text(command.actorUid, 64) || !text(command.productCode, 64) || command.productCode.includes('/')
    || command.action !== 'read' || !Number.isSafeInteger(command.page) || command.page < 1 || command.page > 1000000
    || !Number.isSafeInteger(command.pageSize) || command.pageSize < 1 || command.pageSize > 200
    || envelope.targetApp !== 'assets' || envelope.operationCode !== operation || envelope.commandSchemaVersion !== operation
    || envelope.requiredCapability !== productAdoptionReadCapability || !text(envelope.operationId, 128) || !text(envelope.idempotencyKey, 200)
    || envelope.commandSha256 !== await hashServiceCommandPayload(command)) {
    throw createError({
      statusCode: 403,
      message: '产品采用签名命令无效',
      data: { reason: 'product_adoption_command_invalid' }
    })
  }
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401, message: '缺少服务令牌' })
  await verifyServiceCommandRuntimeHeaders({
    token, method: 'POST', requestTarget: getRequestURL(event).pathname, requestId: getHeader(event, 'x-request-id') || '',
    tenantCode: binding.tenant, sourceDeploymentCode: binding.sourceDeployment, targetDeploymentCode: binding.targetDeployment,
    sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'assets',
    envelope: { operationId: envelope.operationId, targetApp: envelope.targetApp, operationCode: envelope.operationCode, requiredCapability: envelope.requiredCapability, idempotencyKey: envelope.idempotencyKey, commandSchemaVersion: envelope.commandSchemaVersion, commandSha256: envelope.commandSha256 },
    readHeader: name => getHeader(event, name)
  })
  const scopes = await resolveProductAdoptionAuthorization(event, command.actorUid)
  const response = await maybeCallTenantRuntime<{ code: number, data: Record<string, unknown> }>(event, '/v1/assets/internal/product-adoption:read', {
    appCode: 'assets', method: 'POST', scope: `assets.read ${productAdoptionReadCapability}`,
    serviceTokenSourceBinding: 'service-client-policy', serviceCommandActor: { uid: command.actorUid },
    body: { serviceCommand: envelope, productAdoptionAuthorization: { ...scopes, expiresAt: Date.now() + 15000 } }
  })
  if (!response.handled || response.data.code !== 0) throw createError({ statusCode: 503, message: '产品采用运行服务暂不可用' })
  const result = response.data.data
  if (!result || result.productCode !== command.productCode || result.page !== command.page || result.pageSize !== command.pageSize
    || !Number.isSafeInteger(result.total) || Number(result.total) < 0 || !Array.isArray(result.items)
    || result.items.length !== Math.min(command.pageSize, Math.max(0, Number(result.total) - (command.page - 1) * command.pageSize))) {
    throw createError({ statusCode: 503, message: '产品采用查询响应无效' })
  }
  return { code: 0, data: { productCode: result.productCode, queriedAt: result.queriedAt, summary: result.summary, items: result.items, total: result.total, page: result.page, pageSize: result.pageSize } }
}
