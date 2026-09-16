import { createError, getHeader, getQuery, getRequestURL, readBody, setHeader } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { downloadDocument } from '~~/server/utils/oss'
import { hasMeaningfulMarkdownContent, recoverMarkdownFromYjsSnapshot } from '~~/server/utils/yjsMarkdownRecovery'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { AIMS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH, requireCodocsServiceAuth, requireCodocsCrossAppServiceTenantDeploymentBinding } from '~~/server/utils/serviceAuthGuard'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'POST') throw createError({ statusCode: 405, message: 'POST required' })
  const auth = await requireConsoleAuthContext(event)
  requireCodocsServiceAuth(auth, AIMS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH)
  const binding = requireCodocsCrossAppServiceTenantDeploymentBinding(auth, getHeader(event, 'x-hzy-tenant'), getHeader(event, 'x-hzy-deployment'))
  if (getHeader(event, 'x-hzy-app-code') !== 'codocs') throw createError({ statusCode: 403, message: '产品文档目标应用不匹配' })
  const uuid = /\/service\/product-documents\/([^/]+)\/content$/.exec(getRequestURL(event).pathname)?.[1] || ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid) || uuid === '00000000-0000-0000-0000-000000000000' || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '文档身份或查询参数无效' })
  const body = await readBody(event)
  const envelope = body?.serviceCommand
  const command = envelope?.command
  const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.isWellFormed() && value.length > 0 && value === value.trim() && [...value].length <= max && !Array.from(value).some(char => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159))
  if (!body || Object.keys(body).length !== 1 || !envelope || typeof envelope !== 'object' || !command || typeof command !== 'object' || Object.keys(command).length !== 4 || !text(command.actorUid, 64) || !text(command.productCode, 64) || command.productCode.includes('/') || command.documentUuid !== uuid || command.action !== 'content:read' || envelope.targetApp !== 'codocs' || envelope.operationCode !== 'aims.codocs.product-document.content-read.v1' || envelope.requiredCapability !== AIMS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH.scope || envelope.commandSchemaVersion !== 'aims.codocs.product-document.content-read.v1' || !text(envelope.operationId, 128) || !text(envelope.idempotencyKey, 200) || envelope.commandSha256 !== await hashServiceCommandPayload(command)) throw createError({ statusCode: 403, message: '产品文档签名命令无效' })
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401, message: '缺少服务令牌' })
  await verifyServiceCommandRuntimeHeaders({
    token, method: 'POST', requestTarget: getRequestURL(event).pathname, requestId: getHeader(event, 'x-request-id') || '',
    tenantCode: binding.tenant, sourceDeploymentCode: binding.sourceDeployment, targetDeploymentCode: binding.targetDeployment,
    sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'codocs',
    envelope: { operationId: envelope.operationId, targetApp: envelope.targetApp, operationCode: envelope.operationCode, requiredCapability: envelope.requiredCapability, idempotencyKey: envelope.idempotencyKey, commandSchemaVersion: envelope.commandSchemaVersion, commandSha256: envelope.commandSha256 },
    readHeader: name => getHeader(event, name)
  })
  const result = await callCodocsTenantRuntime<{ uuid: string, title: string, docType: string, updatedAt: string, contentSize: number, ossPath: string }>(event, `/v1/codocs/service/product-documents/${uuid}/content`, {
    method: 'POST', scope: 'codocs.read codocs:product-document:read', serviceTokenSourceBinding: 'service-client-policy', serviceCommandActor: { uid: command.actorUid }, body: { serviceCommand: envelope }
  })
  if (!result || result.uuid !== uuid || !text(result.title, 2000) || !text(result.docType, 64) || !text(result.updatedAt, 64) || !text(result.ossPath, 2000) || !Number.isSafeInteger(result.contentSize) || result.contentSize < 0) throw createError({ statusCode: 503, message: '产品文档正文授权响应不完整' })
  let content: string
  try {
    content = (await downloadDocument(result.ossPath, result.docType)) || ''
    if (!hasMeaningfulMarkdownContent(content)) content = await recoverMarkdownFromYjsSnapshot(result.ossPath, result.docType)
  } catch {
    throw createError({ statusCode: 503, message: '产品文档正文暂不可用，请重试' })
  }
  return { code: 0, data: { uuid: result.uuid, title: result.title, docType: result.docType, updatedAt: result.updatedAt, contentSize: result.contentSize, content } }
})
