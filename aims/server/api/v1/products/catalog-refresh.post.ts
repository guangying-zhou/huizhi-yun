import { createError, getHeader, readBody, setHeader } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductOnboardPermission } from '../../../utils/productGlobalAuthorization'
import { catalogRefreshInput, type CatalogRefreshState } from '../../../utils/productCatalogRefreshInput'
import { fetchProductCatalog } from '../../../utils/productCatalog'
import { productCommandKey } from '../../../utils/productWorkspaceInput'
import { runtimeEnvelopeError } from '../../../utils/aimsRuntimeForward'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const uid = await requireProductOnboardPermission(event)
  const authorization = { actor_uid: uid, resource: 'products', action: 'onboard', expires_at: Date.now() + 15000 }
  const input = catalogRefreshInput(await readBody(event))
  if (!input) throw createError({ statusCode: 400, message: '目录刷新参数无效' })
  const key = productCommandKey(getHeader(event, 'Idempotency-Key'))
  if (input.action === 'start' && !key) throw createError({ statusCode: 400, message: '启动刷新需要幂等键' })
  const call = async (action: 'start' | 'view' | 'append' | 'fail', page?: unknown) => {
    const runtime = await maybeCallTenantRuntime<{ code: number, data: CatalogRefreshState }>(event, `/v1/aims/internal/product-catalog/${action}`, {
      appCode: 'aims', method: 'POST', scope: `aims.${action === 'view' ? 'read' : 'write'} aims:products:onboard`,
      query: { current_user: uid }, ...(key ? { idempotencyKey: key } : {}),
      body: { authorization, input: { refresh_id: input.refreshId, expected_revision: input.expectedRevision }, ...(page ? { page } : {}) }
    })
    if (!runtime.handled) throw createError({ statusCode: 503, message: '产品目录运行服务暂不可用' })
    if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
    return runtime.data
  }
  if (input.action === 'start') return call('start')
  if (input.action === 'cancel') return call('fail')
  const current = await call('view')
  if (input.action === 'status' || current.data.status !== 'staging') return current
  if (current.data.revision !== input.expectedRevision) throw createError({ statusCode: 409, message: '目录刷新进度已变化，请读取最新状态后继续' })
  if (!Number.isSafeInteger(current.data.next_page) || current.data.next_page < 1) throw createError({ statusCode: 503, message: '目录游标无效' })
  try {
    const page = await fetchProductCatalog(event, { page: String(current.data.next_page), pageSize: '100', ...(current.data.watermark ? { watermark: current.data.watermark } : {}) })
    return await call('append', page)
  } catch (error) {
    // Source changes invalidate this batch. A transient dependency outage leaves
    // it resumable. Either way the previous active generation stays readable.
    const status = (error as { statusCode?: number }).statusCode
    const code = (error as { data?: { code?: string } }).data?.code
    if (status === 409 && code === 'product_catalog_changed') await call('fail')
    throw error
  }
})
