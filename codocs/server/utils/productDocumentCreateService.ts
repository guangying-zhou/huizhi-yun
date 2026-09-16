import { requireProductDocumentCreateEligibility } from './productDocumentCreateEligibility'
import { uploadPreparedProductDocument, type ProductCreationSnapshot } from './productDocumentCreationUpload'
import { createError, getHeader, getQuery, getRequestURL, readBody, setHeader } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { downloadDocument, uploadDocument } from '~~/server/utils/oss'
import { hasMeaningfulMarkdownContent, recoverMarkdownFromYjsSnapshot } from '~~/server/utils/yjsMarkdownRecovery'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { AIMS_PRODUCT_DOCUMENT_CREATE_SERVICE_AUTH, requireCodocsServiceAuth, requireCodocsCrossAppServiceTenantDeploymentBinding } from '~~/server/utils/serviceAuthGuard'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'POST') throw createError({ statusCode: 405, message: 'POST required' })
  const auth = await requireConsoleAuthContext(event)
  requireCodocsServiceAuth(auth, AIMS_PRODUCT_DOCUMENT_CREATE_SERVICE_AUTH)
  const binding = requireCodocsCrossAppServiceTenantDeploymentBinding(auth, getHeader(event, 'x-hzy-tenant'), getHeader(event, 'x-hzy-deployment'))
  if (getHeader(event, 'x-hzy-app-code') !== 'codocs') throw createError({ statusCode: 403, message: '产品文档目标应用不匹配' })
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '创建请求不接受查询参数' })
  const body = await readBody(event)
  const envelope = body?.serviceCommand
  const command = envelope?.command
  const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) && value !== '00000000-0000-0000-0000-000000000000'
  const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.isWellFormed() && value.length > 0 && value === value.trim() && [...value].length <= max && !Array.from(value).some(char => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159))
  if (!body || Object.keys(body).length !== 1 || !envelope || typeof envelope !== 'object' || !command || typeof command !== 'object' || Object.keys(command).length !== 6 || !text(command.actorUid, 64) || !text(command.productCode, 64) || command.productCode.includes('/') || !uuid(command.documentUuid) || !uuid(command.templateUuid) || command.documentUuid === command.templateUuid || !text(command.title, 200) || command.action !== 'create' || envelope.targetApp !== 'codocs' || envelope.operationCode !== 'aims.codocs.product-document.create.v1' || envelope.requiredCapability !== AIMS_PRODUCT_DOCUMENT_CREATE_SERVICE_AUTH.scope || envelope.commandSchemaVersion !== 'product-document-create.v1' || !uuid(envelope.operationId) || !text(envelope.idempotencyKey, 191) || envelope.commandSha256 !== await hashServiceCommandPayload(command)) throw createError({ statusCode: 403, message: '产品文档签名命令无效' })
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401, message: '缺少服务令牌' })
  await verifyServiceCommandRuntimeHeaders({
    token, method: 'POST', requestTarget: getRequestURL(event).pathname, requestId: getHeader(event, 'x-request-id') || '',
    tenantCode: binding.tenant, sourceDeploymentCode: binding.sourceDeployment, targetDeploymentCode: binding.targetDeployment,
    sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'codocs',
    envelope: { operationId: envelope.operationId, targetApp: envelope.targetApp, operationCode: envelope.operationCode, requiredCapability: envelope.requiredCapability, idempotencyKey: envelope.idempotencyKey, commandSchemaVersion: envelope.commandSchemaVersion, commandSha256: envelope.commandSha256 },
    readHeader: name => getHeader(event, name)
  })
  await requireProductDocumentCreateEligibility(event, command.actorUid)
  const call = <T>(stage: string, extra: Record<string, unknown> = {}) => callCodocsTenantRuntime<T>(event, `/v1/codocs/service/product-documents/create/${stage}`, {
    method: 'POST', scope: 'codocs.write codocs:product-document:create', serviceTokenSourceBinding: 'service-client-policy', serviceCommandActor: { uid: command.actorUid }, body: { serviceCommand: envelope, ...extra }
  })
  const grant = await call<{ uuid: string, docType: string, ossPath: string }>('template')
  if (grant?.uuid !== command.templateUuid || !text(grant.docType, 64) || !text(grant.ossPath, 2000)) throw createError({ statusCode: 503, message: '模板读取授权无效' })
  let content: string
  try {
    content = (await downloadDocument(grant.ossPath, grant.docType)) || ''
    if (!hasMeaningfulMarkdownContent(content)) content = await recoverMarkdownFromYjsSnapshot(grant.ossPath, grant.docType)
  } catch {
    throw createError({ statusCode: 503, message: '模板正文暂不可用，请重试' })
  }
  const snapshot = await call<ProductCreationSnapshot>('prepare', { templateContent: content })
  const receipt = await uploadPreparedProductDocument(snapshot, { operationId: envelope.operationId, documentUuid: command.documentUuid }, {
    upload: uploadDocument,
    complete: async (uploadedPath, uploadedHash) => {
      await requireProductDocumentCreateEligibility(event, command.actorUid)
      return call<{ operationId: string, operationCode: string, idempotencyKey: string, commandSchemaVersion: string, commandSha256: string, receiptId: string, receiptStatus: string, idempotent: boolean, targetBizType: string, targetBizCode: string, responseSummarySha256: string, result: { uuid: string, title: string, productCode: string } }>('complete', { uploadedPath, uploadedHash })
    }
  })
  if (!uuid(receipt?.receiptId) || receipt.operationId !== envelope.operationId || receipt.operationCode !== envelope.operationCode || receipt.idempotencyKey !== envelope.idempotencyKey || receipt.commandSchemaVersion !== envelope.commandSchemaVersion || receipt.commandSha256 !== envelope.commandSha256 || receipt.receiptStatus !== 'succeeded' || typeof receipt.idempotent !== 'boolean' || receipt.targetBizType !== 'product_document' || receipt.targetBizCode !== command.documentUuid || receipt.result?.uuid !== command.documentUuid || receipt.result.productCode !== command.productCode || receipt.result.title !== command.title || !/^[0-9a-f]{64}$/.test(receipt.responseSummarySha256)) throw createError({ statusCode: 503, message: '文档创建回执无效，请重试' })
  return { code: 0, data: { operationId: receipt.operationId, operationCode: receipt.operationCode, idempotencyKey: receipt.idempotencyKey, commandSchemaVersion: receipt.commandSchemaVersion, commandSha256: receipt.commandSha256, receiptId: receipt.receiptId, receiptStatus: 'succeeded', idempotent: receipt.idempotent, targetBizType: receipt.targetBizType, targetBizCode: receipt.targetBizCode, responseSummarySha256: receipt.responseSummarySha256, result: { uuid: receipt.result.uuid, title: receipt.result.title, productCode: receipt.result.productCode } } }
})
