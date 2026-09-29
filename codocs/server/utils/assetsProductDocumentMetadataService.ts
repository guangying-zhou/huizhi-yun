import { createError, getHeader, getQuery, getRequestURL, getRouterParam, readBody, setHeader } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { ASSETS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH, ENTERPRISE_ASSETS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH, requireCodocsServiceAuth, requireCodocsCrossAppServiceTenantDeploymentBinding } from '~~/server/utils/serviceAuthGuard'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const auth = await requireConsoleAuthContext(event)
  const sourceApp = auth?.appCode === 'enterprise' ? 'enterprise' : 'assets'
  requireCodocsServiceAuth(auth, sourceApp === 'enterprise' ? ENTERPRISE_ASSETS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH : ASSETS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH)
  const binding = requireCodocsCrossAppServiceTenantDeploymentBinding(auth, getHeader(event, 'x-hzy-tenant'), getHeader(event, 'x-hzy-deployment'))
  if (getHeader(event, 'x-hzy-app-code') !== 'codocs') throw createError({ statusCode: 403, message: '产品文档目标应用不匹配' })
  const uuid = getRouterParam(event, 'uuid') || ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid) || uuid === '00000000-0000-0000-0000-000000000000' || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '文档身份或查询参数无效' })
  const body = await readBody(event)
  const envelope = body?.serviceCommand
  const command = envelope?.command
  const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.isWellFormed() && value.length > 0 && value === value.trim() && [...value].length <= max && !Array.from(value).some(char => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159))
  if (!body || Object.keys(body).length !== 1 || !envelope || typeof envelope !== 'object' || !command || typeof command !== 'object' || Object.keys(command).length !== 4 || !text(command.actorUid, 64) || !text(command.productCode, 64) || command.productCode.includes('/') || command.documentUuid !== uuid || command.action !== 'metadata:read' || envelope.targetApp !== 'codocs' || envelope.operationCode !== 'assets.codocs.product-document.read.v1' || envelope.requiredCapability !== ASSETS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH.scope || envelope.commandSchemaVersion !== 'assets.codocs.product-document.read.v1' || !text(envelope.operationId, 128) || !text(envelope.idempotencyKey, 200) || envelope.commandSha256 !== await hashServiceCommandPayload(command)) throw createError({ statusCode: 403, message: '产品文档签名命令无效' })
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401, message: '缺少服务令牌' })
  await verifyServiceCommandRuntimeHeaders({
    token, method: 'POST', requestTarget: getRequestURL(event).pathname, requestId: getHeader(event, 'x-request-id') || '',
    tenantCode: binding.tenant, sourceDeploymentCode: binding.sourceDeployment, targetDeploymentCode: binding.targetDeployment,
    sourceApp, sourceClientId: `${sourceApp}.runtime`, targetApp: 'codocs',
    envelope: { operationId: envelope.operationId, targetApp: envelope.targetApp, operationCode: envelope.operationCode, requiredCapability: envelope.requiredCapability, idempotencyKey: envelope.idempotencyKey, commandSchemaVersion: envelope.commandSchemaVersion, commandSha256: envelope.commandSha256 },
    readHeader: name => getHeader(event, name)
  })
  const result = await callCodocsTenantRuntime<{ uuid: string, title: string, doc_type: string, updated_at: string }>(event, `/v1/codocs/service/assets-product-documents/${uuid}/metadata`, {
    method: 'POST', scope: 'codocs.read codocs:product-document:read', serviceTokenSourceBinding: 'service-client-policy', serviceCommandActor: { uid: command.actorUid }, body: { serviceCommand: envelope }
  })
  if (!result || result.uuid !== uuid || !text(result.title, 2000) || !text(result.doc_type, 64) || !text(result.updated_at, 64)) throw createError({ statusCode: 503, message: '产品文档元数据响应不完整' })
  return { code: 0, data: { uuid: result.uuid, title: result.title, doc_type: result.doc_type, updated_at: result.updated_at } }
})
