import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { assetsObjectScopeFromScopedAuthorization, assetsObjectScopeQuery } from '../../../assets/server/utils/assetsScopedAuthorizationCore'
import { readProductDocumentMetadataTransport } from '../../../assets/server/utils/assetProductDocumentTransport'

const operations = {
  'link-base': 'assets.products-link-base', 'link-asset': 'assets.products-link-asset', 'link-document': 'assets.products-link-document',
  'base-candidates': 'assets.products-base-candidates', 'asset-candidates': 'assets.products-asset-candidates'
} as const

export async function handleEnterpriseAssetsLinks(event: H3Event, action: keyof typeof operations) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  if (!Object.hasOwn(operations, action) || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '关联参数无效' })
  const write = action.startsWith('link-')
  const permit = async (resource: string, permission: 'view' | 'edit') => {
    const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode: resource, action: permission })
    const scope = assetsObjectScopeFromScopedAuthorization(snapshot, resource, permission)
    if (scope.access === 'none') throw createError({ statusCode: 403, message: '无关联对象访问权限' })
    return { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource, action: permission, expiresAt: enterpriseRuntimePermitExpiresAt(), scope: assetsObjectScopeQuery(scope) }
  }
  const authorization = await permit('products', write ? 'edit' : 'view')
  const id = write ? Number(getRouterParam(event, 'id')) : undefined
  if (write && (!Number.isSafeInteger(id) || id! < 1)) throw createError({ statusCode: 400, message: '产品编号无效' })
  let input: Record<string, unknown> | undefined
  let idempotencyKey: string | undefined
  if (write) {
    idempotencyKey = getHeader(event, 'Idempotency-Key')?.trim()
    if (!idempotencyKey || idempotencyKey.length > 240) throw createError({ statusCode: 400, message: '缺少有效操作标识' })
    input = await readBody(event)
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw createError({ statusCode: 400, message: '关联内容无效' })
    const fields = action === 'link-base' ? ['technology_base_id'] : action === 'link-asset' ? ['asset_id', 'relation_type', 'is_primary'] : ['document_id', 'document_type', 'remark']
    if (Object.keys(input).some(k => !fields.includes(k))) throw createError({ statusCode: 400, message: '关联字段无效' })
  }
  if (action === 'link-document') {
    const uuid = input!.document_id
    if (typeof uuid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid) || uuid === '00000000-0000-0000-0000-000000000000') throw createError({ statusCode: 400, message: '文档 UUID 无效' })
    const product = await callEnterpriseRuntime<{ code: number, data: { product_code: string } }>(event, 'assets.products-view', { id, authorization: { ...authorization, action: 'view' } })
    if (product.code !== 0 || !product.data?.product_code) throw createError({ statusCode: 503, message: '产品身份暂不可用' })
    await readProductDocumentMetadataTransport(event, product.data.product_code, uuid, user.uid, 'enterprise')
    return callEnterpriseRuntime(event, operations[action], { id, input, authorization, documentAuthorization: { productId: id, productCode: product.data.product_code, documentUuid: uuid, actorUid: user.uid, expiresAt: enterpriseRuntimePermitExpiresAt() } }, { idempotencyKey })
  }
  const targetAuthorization = await permit(action.includes('asset') ? 'asset_items' : 'technology_bases', 'view')
  return callEnterpriseRuntime(event, operations[action], { id, input, authorization, targetAuthorization }, { idempotencyKey })
}
