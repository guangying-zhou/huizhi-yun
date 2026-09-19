import { createError, getHeader, type H3Event } from 'h3'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { buildServiceCommandRuntimeHeaders, hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'

export interface DocumentMetadata { uuid: string, title: string, doc_type: string, updated_at: string }
const validText = (value: unknown, max: number): value is string => typeof value === 'string' && value.isWellFormed() && value.length > 0 && value === value.trim() && [...value].length <= max && !/[\p{Cc}]/u.test(value)

// Caller first resolves the product under its object scope. This read checks
// the current user's independent Codocs ACL; it grants no document access.
// Internal transport: callers establish the user and owning product permission.
export async function readProductDocumentMetadataTransport(event: H3Event, productCode: string, documentUuid: string, actorUid: string, sourceApp: 'assets' | 'enterprise'): Promise<DocumentMetadata> {
  if (!validText(productCode, 64) || productCode.includes('/') || !validText(actorUid, 64) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(documentUuid) || documentUuid === '00000000-0000-0000-0000-000000000000') throw createError({ statusCode: 400, message: '产品或文档身份无效' })
  const gateway = resolveTrustedTenantGatewayContext(event)
  const route = resolveTrustedServiceAppRoute(event, 'codocs')
  if (!gateway?.tenant || !gateway.deployment || !route) throw createError({ statusCode: 503, message: '文档服务路由暂不可用' })
  const command = { actorUid, productCode, documentUuid, action: 'metadata:read' }
  const hash = await hashServiceCommandPayload(command)
  const operation = 'assets.codocs.product-document.read.v1'
  const serviceCommand = { operationId: `${operation}:${hash.slice(0, 24)}`, targetApp: 'codocs', operationCode: operation, requiredCapability: 'codocs:product-document:read', idempotencyKey: `assets:product-document:${hash.slice(0, 32)}`, commandSchemaVersion: operation, commandSha256: hash, command }
  const url = `${route.baseUrl.replace(/\/+$/, '')}/api/v1/service/assets-product-documents/${documentUuid}/metadata`
  const requestId = getHeader(event, 'x-request-id') || crypto.randomUUID()
  const token = await requestServiceAccessToken({ event, audience: 'codocs', scope: serviceCommand.requiredCapability })
  const signature = await buildServiceCommandRuntimeHeaders({ token, method: 'POST', requestTarget: new URL(url).pathname, requestId, tenantCode: gateway.tenant, sourceDeploymentCode: gateway.deployment, targetDeploymentCode: route.deploymentCode, sourceApp, sourceClientId: `${sourceApp}.runtime`, targetApp: 'codocs', envelope: serviceCommand })
  const response = await serviceAppFetch<{ code: number, data: DocumentMetadata }>(event, 'codocs', url, { method: 'POST', timeout: 20000, headers: { ...trustedServiceRequestHeaders(event, 'codocs'), 'Authorization': `Bearer ${token}`, 'x-request-id': requestId, ...signature }, body: { serviceCommand } })
  const data = response?.data
  if (response?.code !== 0 || data?.uuid !== documentUuid || !validText(data.title, 2000) || !validText(data.doc_type, 64) || !validText(data.updated_at, 64)) throw createError({ statusCode: 503, message: '文档服务响应不完整' })
  return { uuid: data.uuid, title: data.title, doc_type: data.doc_type, updated_at: data.updated_at }
}
