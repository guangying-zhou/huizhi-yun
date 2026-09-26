import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { checkProductPermission } from '../../../aims/server/utils/productAuthorization'
import { enterpriseProductAuthorizationSource } from './enterpriseProductAuthorization'

const codePattern = /^[^/\p{Cc}]{1,64}$/u
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const purposes = new Set(['product-overview', 'requirements', 'design', 'release-notes', 'user-guide', 'other'])

export async function enterpriseProductDocumentLink(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '文档关联不接受查询参数' })
  const productCode = getRouterParam(event, 'productCode') || ''
  if (!codePattern.test(productCode) || productCode !== productCode.trim()) throw createError({ statusCode: 400, message: '产品编码无效' })
  const idempotencyKey = String(getHeader(event, 'Idempotency-Key') || '').trim()
  if (!idempotencyKey || idempotencyKey.length > 191) throw createError({ statusCode: 400, message: '缺少有效操作标识' })
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || Array.isArray(body) || Object.keys(body).length !== 3 || Object.keys(body).some(key => !['documentUuid', 'purpose', 'expectedRevision'].includes(key)) || !uuidPattern.test(String(body.documentUuid)) || body.documentUuid === '00000000-0000-0000-0000-000000000000' || !purposes.has(String(body.purpose)) || typeof body.expectedRevision !== 'number' || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) throw createError({ statusCode: 400, message: '文档关联参数无效' })
  const user = await requireEnterpriseUser(event)
  const source = await enterpriseProductAuthorizationSource(event)
  const product = await checkProductPermission(event, productCode, 'products', 'view', source)
  if (!product.allowed) throw createError({ statusCode: 404, message: '产品不存在或不可见' })
  const permission = await checkProductPermission(event, productCode, 'product_documents', 'edit', source)
  if (!permission.allowed) throw createError({ statusCode: 403, message: '缺少产品文档编辑权限' })
  await prepareEnterpriseRuntime(event, 'aims.product-document-link')
  const response = await callEnterpriseRuntime<{ code: number, data: { value?: { product_code?: string, document_uuid?: string, purpose?: string } } }>(event, 'aims.product-document-link', {
    productCode, tenant: user.tenant, deployment: user.deployment,
    authorization: { resource: 'product_documents', action: 'edit', facts: permission.facts, expires_at: enterpriseRuntimePermitExpiresAt() },
    input: { document_uuid: body.documentUuid, purpose: body.purpose, expected_revision: body.expectedRevision }
  }, { idempotencyKey })
  if (response.code !== 0 || response.data?.value?.product_code !== productCode || response.data.value.document_uuid !== body.documentUuid || response.data.value.purpose !== body.purpose) throw createError({ statusCode: 503, message: '文档关联响应无效' })
  return response
}
