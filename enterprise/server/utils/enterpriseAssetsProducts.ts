import { createError, getQuery, getRouterParam, getHeader, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { readProductDocumentMetadataTransport } from '../../../assets/server/utils/assetProductDocumentTransport'
import { assetsObjectScopeFromScopedAuthorization, assetsObjectScopeQuery } from '../../../assets/server/utils/assetsScopedAuthorizationCore'

const reads = {
  list: 'assets.products-list', view: 'assets.products-view',
  dictionaries: 'assets.product-dictionaries', categories: 'assets.product-categories',
  create: 'assets.products-create', edit: 'assets.products-edit'
} as const

export async function handleEnterpriseAssetsProducts(event: H3Event, action: keyof typeof reads) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  if (!Object.hasOwn(reads, action)) throw createError({ statusCode: 400, message: '不支持的产品操作' })
  const query = getQuery(event)
  const allowed = action === 'list'
    ? ['page', 'pageSize', 'search', 'product_line', 'status', 'sortBy', 'sortOrder']
    : action === 'categories' ? ['scope', 'pageSize'] : []
  if (Object.entries(query).some(([key, value]) => !allowed.includes(key) || typeof value !== 'string')) {
    throw createError({ statusCode: 400, message: '产品参数无效' })
  }
  let id: number | undefined
  if (action === 'view' || action === 'edit') {
    id = Number(getRouterParam(event, 'id'))
    if (!Number.isSafeInteger(id) || id < 1) throw createError({ statusCode: 400, message: '产品编号无效' })
  }
  const permission = action === 'create' || action === 'edit' ? 'edit' : 'view'
  await prepareEnterpriseRuntime(event, reads[action])
  const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode: 'products', action: permission })
  const scope = assetsObjectScopeFromScopedAuthorization(snapshot, 'products', permission)
  if (scope.access === 'none') throw createError({ statusCode: 403, message: '无产品查看权限' })
  // Category pageSize is a legacy presentation hint; category groups are not paged.
  const runtimeQuery = action === 'categories' ? { scope: query.scope || 'product' } : query
  let input: Record<string, unknown> | undefined
  let idempotencyKey: string | undefined
  if (permission === 'edit') {
    const key = getHeader(event, 'Idempotency-Key')?.trim()
    if (!key || key.length > 240) throw createError({ statusCode: 400, message: '缺少有效操作标识' })
    idempotencyKey = key
    input = await readBody(event)
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw createError({ statusCode: 400, message: '产品内容无效' })
  }
  const relatedPermit = async (resource: string) => {
    const current = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode: resource, action: 'view' })
    const related = assetsObjectScopeFromScopedAuthorization(current, resource, 'view')
    if (related.access === 'none') return undefined
    return { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource, action: 'view', expiresAt: enterpriseRuntimePermitExpiresAt(), scope: assetsObjectScopeQuery(related) }
  }
  const [baseAuthorization, assetAuthorization] = action === 'list' || action === 'view'
    ? await Promise.all([relatedPermit('technology_bases'), relatedPermit('asset_items')])
    : []
  const result = await callEnterpriseRuntime<{ code: number, data: Record<string, unknown> }>(event, reads[action], {
    id, query: runtimeQuery, input, baseAuthorization, assetAuthorization,
    authorization: {
      actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
      resource: 'products', action: permission, expiresAt: enterpriseRuntimePermitExpiresAt(),
      scope: assetsObjectScopeQuery(scope)
    }
  }, { idempotencyKey })
  if (action === 'view' && Array.isArray(result.data?.documents)) {
    const visible = []
    for (const item of result.data.documents) {
      try {
        await readProductDocumentMetadataTransport(event, String(result.data.product_code || ''), String(item.document_id || ''), user.uid, 'enterprise')
        visible.push(item)
      } catch (error) {
        const status = Number((error as { statusCode?: number }).statusCode)
        if (![403, 404].includes(status)) throw error
      }
    }
    result.data.documents = visible
  }
  return result
}
