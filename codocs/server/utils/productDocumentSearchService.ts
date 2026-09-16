import { createError, getHeader, getQuery, getRequestURL, readBody, setHeader } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { AIMS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH, requireCodocsServiceAuth, requireCodocsCrossAppServiceTenantDeploymentBinding } from '~~/server/utils/serviceAuthGuard'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const auth = await requireConsoleAuthContext(event)
  requireCodocsServiceAuth(auth, AIMS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH)
  const binding = requireCodocsCrossAppServiceTenantDeploymentBinding(auth, getHeader(event, 'x-hzy-tenant'), getHeader(event, 'x-hzy-deployment'))
  if (getHeader(event, 'x-hzy-app-code') !== 'codocs') throw createError({ statusCode: 403, message: '产品文档目标应用不匹配' })
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '文档搜索不接受查询参数' })
  const body = await readBody(event)
  const envelope = body?.serviceCommand
  const command = envelope?.command
  const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.isWellFormed() && value.length > 0 && value === value.trim() && [...value].length <= max && !Array.from(value).some(char => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159))
  if (!body || Object.keys(body).length !== 1 || !envelope || typeof envelope !== 'object' || !command || typeof command !== 'object' || Object.keys(command).length !== 6 || !text(command.actorUid, 64) || !text(command.productCode, 64) || command.productCode.includes('/') || command.action !== 'search' || typeof command.search !== 'string' || (command.search !== '' && !text(command.search, 200)) || !Number.isSafeInteger(command.page) || command.page < 1 || command.page > 1000000 || !Number.isSafeInteger(command.pageSize) || command.pageSize < 1 || command.pageSize > 100 || envelope.targetApp !== 'codocs' || envelope.operationCode !== 'aims.codocs.product-document.search.v1' || envelope.requiredCapability !== AIMS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH.scope || envelope.commandSchemaVersion !== 'aims.codocs.product-document.search.v1' || !text(envelope.operationId, 128) || !text(envelope.idempotencyKey, 200) || envelope.commandSha256 !== await hashServiceCommandPayload(command)) throw createError({ statusCode: 403, message: '产品文档签名命令无效' })
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401, message: '缺少服务令牌' })
  await verifyServiceCommandRuntimeHeaders({
    token, method: 'POST', requestTarget: getRequestURL(event).pathname, requestId: getHeader(event, 'x-request-id') || '',
    tenantCode: binding.tenant, sourceDeploymentCode: binding.sourceDeployment, targetDeploymentCode: binding.targetDeployment,
    sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'codocs',
    envelope: { operationId: envelope.operationId, targetApp: envelope.targetApp, operationCode: envelope.operationCode, requiredCapability: envelope.requiredCapability, idempotencyKey: envelope.idempotencyKey, commandSchemaVersion: envelope.commandSchemaVersion, commandSha256: envelope.commandSha256 },
    readHeader: name => getHeader(event, name)
  })
  type Metadata = { uuid: string, title: string, doc_type: string, updated_at: string }
  const result = await callCodocsTenantRuntime<{ items: Metadata[], total: number, page: number, pageSize: number }>(event, '/v1/codocs/service/product-documents/search', {
    method: 'POST', scope: 'codocs.read codocs:product-document:read', serviceTokenSourceBinding: 'service-client-policy', serviceCommandActor: { uid: command.actorUid }, body: { serviceCommand: envelope }
  })
  if (!result || result.page !== command.page || result.pageSize !== command.pageSize || !Number.isSafeInteger(result.total) || result.total < 0 || !Array.isArray(result.items) || result.items.length !== Math.min(command.pageSize, Math.max(0, result.total - (command.page - 1) * command.pageSize)) || result.items.some(item => !item || !text(item.uuid, 36) || !text(item.title, 2000) || !text(item.doc_type, 64) || !text(item.updated_at, 64))) throw createError({ statusCode: 503, message: '产品文档搜索响应无效' })
  return { code: 0, data: { items: result.items.map(item => ({ uuid: item.uuid, title: item.title, doc_type: item.doc_type, updated_at: item.updated_at })), total: result.total, page: result.page, pageSize: result.pageSize } }
})
