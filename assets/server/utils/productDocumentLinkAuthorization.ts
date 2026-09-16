import { createError, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { extractServiceOperationStatus } from '@hzy/foundation/server/utils/serviceOperation'
import { readAssetProductDocumentMetadata } from './productDocumentCodocs'

export async function authorizeProductDocumentLink(event: H3Event, id: string, body: Record<string, unknown>, uid: string, scope: Record<string, unknown>) {
  const values = ['document_id', 'documentUuid', 'document_uuid'].filter(key => Object.hasOwn(body, key)).map(key => body[key])
  const uuid = values[0]
  if (!/^[1-9]\d*$/.test(id) || typeof uuid !== 'string' || values.some(value => value !== uuid) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid) || uuid === '00000000-0000-0000-0000-000000000000') throw createError({ statusCode: 400, message: '产品或文档身份无效' })
  const product = await maybeCallTenantRuntime<{ code: number, data: { product_code: string } }>(event, `/v1/assets/products/${id}`, { appCode: 'assets', scope: 'assets.read', method: 'GET', query: { ...scope, current_user: uid } })
  if (!product.handled) throw createError({ statusCode: 503, message: '产品服务暂不可用' })
  if (product.data?.code !== 0 || !product.data.data?.product_code) {
    const status = extractServiceOperationStatus(product.data)
    throw createError({ statusCode: status && [401, 403, 404, 429].includes(status) ? status : 503, message: '产品暂时无法读取' })
  }
  const productCode = product.data.data.product_code
  await readAssetProductDocumentMetadata(event, productCode, uuid)
  return { current_user_product_document_uuid: uuid, current_user_product_document_code: productCode, current_user_product_document_id: id, current_user_product_document_actor: uid, current_user_product_document_expires: String(Date.now() + 15000) }
}
