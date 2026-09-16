import { onboardProductLine } from '../../../utils/productLineOnboard'
import { createError, getHeader, readBody, setHeader } from 'h3'
import { fetchDirectoryActiveStatuses } from '@hzy/foundation/server/utils/directoryApi'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductOnboardPermission } from '../../../utils/productGlobalAuthorization'
import { productOnboardInput } from '../../../utils/productOnboardInput'
import { fetchProductCatalog } from '../../../utils/productCatalog'
import { productCommandKey } from '../../../utils/productWorkspaceInput'
import { runtimeEnvelopeError } from '../../../utils/aimsRuntimeForward'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const actor = await requireProductOnboardPermission(event)
  const authorizedUntil = Date.now() + 15000
  const key = productCommandKey(getHeader(event, 'Idempotency-Key'))
  const raw = await readBody(event)
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'productLine' in raw) return onboardProductLine(event, raw)
  const parsed = productOnboardInput(raw)
  if (!key || !parsed) throw createError({ statusCode: 400, message: '产品接入字段或幂等键无效' })
  const { productCode, input } = parsed
  const catalog = await fetchProductCatalog(event, { code: productCode, page: '1', pageSize: '1' })
  const source = catalog.items[0]
  if (catalog.total !== 1 || source?.product_code !== productCode) throw createError({ statusCode: 404, message: 'Assets 产品主档不存在' })
  if (!source.onboardable) throw createError({ statusCode: 409, message: '该产品当前状态不允许接入产品中心' })
  const sourceUntil = Date.now() + 15000
  const states = await fetchDirectoryActiveStatuses(event, [input.manager_uid])
  if (states.length !== 1 || states[0]?.uid !== input.manager_uid || !states[0].active) throw createError({ statusCode: 400, message: '产品负责人不是有效目录用户' })
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event,
    `/v1/aims/internal/products/${encodeURIComponent(productCode)}/onboard`, {
      appCode: 'aims', method: 'POST', scope: 'aims.write aims:products:onboard',
      query: { current_user: actor }, idempotencyKey: key,
      body: {
        input,
        authorization: { product_code: productCode, actor_uid: actor, resource: 'products', action: 'onboard', expires_at: authorizedUntil },
        source: { product_code: productCode, product_line: source.product_line, onboardable: true, watermark: catalog.watermark, expires_at: sourceUntil },
        directory: { active_uids: [input.manager_uid], expires_at: Date.now() + 15000 }
      }
    })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
})
