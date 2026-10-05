import { createError, getHeader, type H3Event } from 'h3'
import { resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { buildServiceCommandRuntimeHeaders, hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireProductPermission } from './productAuthorization'
import { crossDependencyProductCode } from './productCrossDependencyInput'

export interface ProductDocumentMetadata {
  uuid: string
  title: string
  doc_type: string
  updated_at: string
}

// Internal preflight for linking an existing document or enriching a verified
// AIMS relation. This helper does not establish a relation or grant Codocs ACL.
export async function readProductDocumentMetadata(event: H3Event, productCode: string, documentUuid: string): Promise<ProductDocumentMetadata> {
  if (!crossDependencyProductCode(productCode) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(documentUuid) || documentUuid === '00000000-0000-0000-0000-000000000000') {
    throw createError({ statusCode: 400, message: '产品或文档标识无效' })
  }
  const facts = await requireProductPermission(event, productCode, 'product_documents', 'view')
  if (facts.product_code !== productCode || !facts.actor_uid) throw createError({ statusCode: 503, message: '产品授权上下文不一致' })
  const result = await callProductDocumentService<ProductDocumentMetadata>(event, `${documentUuid}/metadata`, 'aims.codocs.product-document.read.v1', { actorUid: facts.actor_uid, productCode, documentUuid, action: 'metadata:read' })
  const data = result?.data
  if (result?.code !== 0 || data?.uuid !== documentUuid || ![data.title, data.doc_type, data.updated_at].every(value => typeof value === 'string' && value.trim().length > 0)) {
    throw createError({ statusCode: 503, message: '产品文档服务响应无效' })
  }
  return { uuid: data.uuid, title: data.title, doc_type: data.doc_type, updated_at: data.updated_at }
}

async function callProductDocumentService<T>(event: H3Event, path: string, operation: string, command: Record<string, unknown>, creation?: { operationId: string, idempotencyKey: string }) {
  const gateway = resolveTrustedTenantGatewayContext(event)
  const route = resolveTrustedServiceAppRoute(event, 'codocs')
  if (!gateway?.tenant || !gateway.deployment || !route) throw createError({ statusCode: 503, message: 'Codocs 可信服务路由不可用' })
  const commandSha256 = await hashServiceCommandPayload(command)
  const serviceCommand = {
    operationId: creation?.operationId || `${operation}:${commandSha256.slice(0, 24)}`,
    targetApp: 'codocs',
    operationCode: operation,
    requiredCapability: creation ? 'codocs:product-document:create' : 'codocs:product-document:read',
    idempotencyKey: creation?.idempotencyKey || `aims:codocs:product-document:${commandSha256.slice(0, 32)}`,
    commandSchemaVersion: creation ? 'product-document-create.v1' : operation,
    commandSha256,
    command
  }
  const url = `${route.baseUrl.replace(/\/+$/, '')}/api/v1/service/product-documents/${path}`
  const requestId = getHeader(event, 'x-request-id') || crypto.randomUUID()
  const token = await requestServiceAccessToken({ event, audience: 'codocs', scope: serviceCommand.requiredCapability })
  const signedHeaders = await buildServiceCommandRuntimeHeaders({
    token, method: 'POST', requestTarget: new URL(url).pathname, requestId,
    tenantCode: gateway.tenant, sourceDeploymentCode: gateway.deployment, targetDeploymentCode: route.deploymentCode,
    sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'codocs', envelope: serviceCommand
  })
  const result = await $fetch<{ code: number, data: T }, string>(url, {
    method: 'POST', retry: 0, timeout: 20000,
    headers: { ...trustedServiceRequestHeaders(event, 'codocs'), 'Authorization': `Bearer ${token}`, 'x-request-id': requestId, ...signedHeaders },
    body: { serviceCommand }
  })
  return result
}

export async function searchProductDocuments(event: H3Event, productCode: string, search: string, page: number, pageSize: number) {
  if (!crossDependencyProductCode(productCode) || typeof search !== 'string' || !search.isWellFormed() || search !== search.trim() || [...search].length > 200 || Array.from(search).some(char => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)) || !Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw createError({ statusCode: 400, message: '文档搜索条件无效' })
  const facts = await requireProductPermission(event, productCode, 'product_documents', 'view')
  if (facts.product_code !== productCode || !facts.actor_uid) throw createError({ statusCode: 503, message: '产品授权上下文不一致' })
  const result = await callProductDocumentService<{ items: ProductDocumentMetadata[], total: number, page: number, pageSize: number }>(event, 'search', 'aims.codocs.product-document.search.v1', { actorUid: facts.actor_uid, productCode, action: 'search', search, page, pageSize })
  const data = result?.data
  if (result?.code !== 0 || !data || data.page !== page || data.pageSize !== pageSize || !Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.items) || data.items.length !== Math.min(pageSize, Math.max(0, data.total - (page - 1) * pageSize)) || data.items.some(item => !item || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.uuid) || item.uuid === '00000000-0000-0000-0000-000000000000' || ![item.title, item.doc_type, item.updated_at].every(value => typeof value === 'string' && value.trim())) || new Set(data.items.map(item => item.uuid)).size !== data.items.length) throw createError({ statusCode: 503, message: '产品文档搜索响应无效' })
  return { items: data.items.map(item => ({ uuid: item.uuid, title: item.title, doc_type: item.doc_type, updated_at: item.updated_at })), total: data.total, page, pageSize }
}

export interface ProductDocumentContent {
  uuid: string
  title: string
  docType: string
  updatedAt: string
  contentSize: number
  content: string
}

// Caller must first resolve the product relation; this checks current Codocs ACL.
export async function readProductDocumentContent(event: H3Event, productCode: string, documentUuid: string): Promise<ProductDocumentContent> {
  if (!crossDependencyProductCode(productCode) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(documentUuid) || documentUuid === '00000000-0000-0000-0000-000000000000') {
    throw createError({ statusCode: 400, message: '产品或文档标识无效' })
  }
  const facts = await requireProductPermission(event, productCode, 'product_documents', 'view')
  if (facts.product_code !== productCode || !facts.actor_uid) throw createError({ statusCode: 503, message: '产品授权上下文不一致' })
  const result = await callProductDocumentService<ProductDocumentContent>(event, `${documentUuid}/content`, 'aims.codocs.product-document.content-read.v1', { actorUid: facts.actor_uid, productCode, documentUuid, action: 'content:read' })
  const data = result?.data
  if (result?.code !== 0 || typeof data?.content !== 'string' || !Number.isSafeInteger(data?.contentSize) || data.contentSize < 0 || data?.uuid !== documentUuid || ![data.title, data.docType, data.updatedAt].every(value => typeof value === 'string' && value.trim().length > 0)) {
    throw createError({ statusCode: 503, message: '产品文档服务响应无效' })
  }
  return { uuid: data.uuid, title: data.title, docType: data.docType, updatedAt: data.updatedAt, contentSize: data.contentSize, content: data.content }
}

export interface ProductDocumentTemplateCreation {
  actorUid: string
  operationId: string
  idempotencyKey: string
  documentUuid: string
  templateUuid: string
  title: string
}

// The caller persists this identity before its first attempt and retains it
// until the created UUID has been linked to the product.
export async function createProductDocumentFromTemplate(event: H3Event, productCode: string, input: ProductDocumentTemplateCreation) {
  const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) && value !== '00000000-0000-0000-0000-000000000000'
  if (!input || typeof input.actorUid !== 'string' || !input.actorUid || input.actorUid !== input.actorUid.trim() || [...input.actorUid].length > 64 || !input.actorUid.isWellFormed() || /[\p{Cc}]/u.test(input.actorUid) || !crossDependencyProductCode(productCode) || !uuid(input.operationId) || !uuid(input.documentUuid) || !uuid(input.templateUuid) || input.documentUuid === input.templateUuid || typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,190}$/.test(input.idempotencyKey) || typeof input.title !== 'string' || !input.title.isWellFormed() || !input.title || input.title !== input.title.trim() || [...input.title].length > 200 || /[\p{Cc}]/u.test(input.title)) throw createError({ statusCode: 400, message: '模板创建参数无效' })
  const facts = await requireProductPermission(event, productCode, 'product_documents', 'edit')
  if (facts.product_code !== productCode || !facts.actor_uid) throw createError({ statusCode: 503, message: '产品授权上下文不一致' })
  if (facts.actor_uid !== input.actorUid) throw createError({ statusCode: 403, message: '请由原创建人重试此请求' })
  const response = await callProductDocumentService<{ receiptId: string, receiptStatus: string, idempotent: boolean, targetBizType: string, targetBizCode: string, responseSummarySha256: string, result: { uuid: string, title: string, productCode: string } }>(event, 'create', 'aims.codocs.product-document.create.v1', { actorUid: facts.actor_uid, productCode, documentUuid: input.documentUuid, templateUuid: input.templateUuid, title: input.title, action: 'create' }, { operationId: input.operationId, idempotencyKey: input.idempotencyKey })
  const receipt = response?.data
  if (response?.code !== 0 || !receipt || !uuid(receipt.receiptId) || receipt.receiptStatus !== 'succeeded' || typeof receipt.idempotent !== 'boolean' || receipt.targetBizType !== 'product_document' || receipt.targetBizCode !== input.documentUuid || receipt.result?.uuid !== input.documentUuid || receipt.result.title !== input.title || receipt.result.productCode !== productCode || !/^[0-9a-f]{64}$/.test(receipt.responseSummarySha256)) throw createError({ statusCode: 503, message: '模板创建回执无效，请重试' })
  return { receiptId: receipt.receiptId, documentUuid: receipt.result.uuid, title: receipt.result.title, idempotent: receipt.idempotent }
}
