import { createHash } from 'node:crypto'
import { createError, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { assetsObjectScopeFromScopedAuthorization, assetsObjectScopeQuery } from '../../../assets/server/utils/assetsScopedAuthorizationCore'
import { handleProductOnboard } from '../../../aims/server/utils/productOnboardingRuntime'
import { handleProductCandidates } from '../../../aims/server/utils/productCandidatesRuntime'
import type { ProductOnboardBridge } from '../../../aims/server/utils/productOnboardBridge'

async function assetsPermit(event: H3Event) {
  const user = await requireEnterpriseUser(event)
  const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode: 'products', action: 'view' })
  const scope = assetsObjectScopeFromScopedAuthorization(snapshot, 'products', 'view')
  return { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'products', action: 'view', expiresAt: enterpriseRuntimePermitExpiresAt(), scope: assetsObjectScopeQuery(scope) }
}
async function candidateBody(event: H3Event, productCode: string) {
  const user = await requireEnterpriseUser(event)
  return { tenant: user.tenant, deployment: user.deployment, authorization: { product_code: productCode, actor_uid: user.uid, resource: 'products', action: 'onboard', expires_at: enterpriseRuntimePermitExpiresAt() }, assets_authorization: await assetsPermit(event) }
}
const bridge: ProductOnboardBridge = {
  async catalog(event, query) {
    const response = await callEnterpriseRuntime<{ code: number, data: Awaited<ReturnType<ProductOnboardBridge['catalog']>> }>(event, 'aims.onboard-candidates', {
      ...await candidateBody(event, '*'), input: { keyword: query.keyword || '', code: query.code || '', productLine: query.productLine || '', watermark: query.watermark || '', page: Number(query.page || 1), pageSize: Number(query.pageSize || 100) }
    })
    if (response.code !== 0 || !response.data) throw createError({ statusCode: 503, message: '产品候选目录暂不可用' })
    return response.data
  },
  async lineCatalog(event, line, expectedWatermark) {
    const code = '~line-' + createHash('sha256').update(line).digest('hex').slice(0, 56)
    const response = await callEnterpriseRuntime<{ code: number, data: Awaited<ReturnType<ProductOnboardBridge['lineCatalog']>> }>(event, 'aims.onboard-line-candidates', { ...await candidateBody(event, code), lineCode: line })
    if (response.code !== 0 || !response.data) throw createError({ statusCode: 503, message: '产品线候选目录暂不可用' })
    if (expectedWatermark && response.data.watermark !== expectedWatermark) throw createError({ statusCode: 409, message: '产品主档已变化，请重新确认' })
    return response.data
  },
  async execute(event, action, productCode, input, authorization, directory, key) {
    const user = await requireEnterpriseUser(event)
    return callEnterpriseRuntime(event, action === 'onboard' ? 'aims.product-onboard' : 'aims.product-line-onboard', {
      tenant: user.tenant, deployment: user.deployment, productCode, ...(action === 'onboard-line' ? { lineCode: input.line_code } : {}),
      input, authorization: { ...authorization, actor_uid: user.uid }, directory, assets_authorization: await assetsPermit(event)
    }, { idempotencyKey: key })
  }
}
export async function enterpriseProductOnboard(event: H3Event) {
  await requireEnterpriseUser(event)
  return handleProductOnboard(event, bridge)
}
export async function enterpriseProductCandidates(event: H3Event) {
  await requireEnterpriseUser(event)
  return handleProductCandidates(event, bridge)
}
