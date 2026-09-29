import type { ProductOnboardBridge } from './productOnboardBridge'
import { createHash } from 'node:crypto'
import { createError, getHeader, setHeader, type H3Event } from 'h3'
import { fetchDirectoryActiveStatuses } from '@hzy/foundation/server/utils/directoryApi'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductOnboardPermission } from './productGlobalAuthorization'
import { productLineOnboardInput } from './productLineInput'
import { fetchProductLineCatalog } from './productLineCatalog'
import { productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function onboardProductLine(event: H3Event, raw: unknown, bridge?: ProductOnboardBridge) {
  setHeader(event, 'Cache-Control', 'no-store')
  await requireProductOnboardPermission(event)
  const input = productLineOnboardInput(raw, { allowCurrentAssetsWatermark: !!bridge })
  const key = productCommandKey(getHeader(event, 'Idempotency-Key'))
  if (!input || !key) throw createError({ statusCode: 400, message: '统一产品管理字段或幂等键无效' })
  const source = await (bridge?.lineCatalog || fetchProductLineCatalog)(event, input.line_code, input.expected_watermark)
  // 选择项必须来自本次目录证据且当前可接入；未选中的产品保持原状，不再阻塞整条产品线。
  // 运行服务会再校验一次，这里先给出明确错误。
  const onboardable = new Map(source.items.map(i => [i.product_code, i.onboardable]))
  if (input.product_codes.some(code => !onboardable.has(code))) throw createError({ statusCode: 409, message: '所选产品不在当前产品线目录中，请重新确认' })
  if (input.product_codes.some(code => !onboardable.get(code))) throw createError({ statusCode: 409, message: '所选产品当前生命周期不允许接入，请先在 Assets 核对' })
  const sourceUntil = Date.now() + 15000
  const states = await fetchDirectoryActiveStatuses(event, [input.manager_uid])
  if (states.length !== 1 || states[0]?.uid !== input.manager_uid || !states[0].active) throw createError({ statusCode: 400, message: '产品负责人不是有效目录用户' })
  const actor = await requireProductOnboardPermission(event)
  const productCode = '~line-' + createHash('sha256').update(input.line_code).digest('hex').slice(0, 56)
  const runtime = bridge
    ? { handled: true, data: await bridge.execute(event, 'onboard-line', productCode, input, { product_code: productCode, actor_uid: actor, resource: 'products', action: 'onboard', expires_at: Date.now() + 15000 }, { active_uids: [input.manager_uid], expires_at: Date.now() + 15000 }, key) }
    : await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, '/v1/aims/internal/product-line-onboard', {
        appCode: 'aims', method: 'POST', scope: 'aims.write aims:products:onboard', query: { current_user: actor }, idempotencyKey: key,
        body: { input, authorization: { product_code: productCode, actor_uid: actor, resource: 'products', action: 'onboard', expires_at: Date.now() + 15000 }, source: { line_code: source.line_code, watermark: source.watermark, items: source.items, total: source.items.length, expires_at: sourceUntil }, directory: { active_uids: [input.manager_uid], expires_at: Date.now() + 15000 } }
      })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
