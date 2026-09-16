import { createError, getQuery, setHeader } from 'h3'
import { compileFoundationProductScope } from '@hzy/foundation/server/utils/scopeEvaluator'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireAimsSessionUid } from '../../../utils/authIdentity'
import { checkProductOnboardPermission } from '../../../utils/productGlobalAuthorization'
import { productListInput } from '../../../utils/productListInput'
import { runtimeEnvelopeError } from '../../../utils/aimsRuntimeForward'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const uid = await requireAimsSessionUid(event)
  const input = productListInput(getQuery(event))
  if (!input) throw createError({ statusCode: 400, message: '产品筛选参数无效' })
  const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, uid, 'aims', { resourceCode: 'products', action: 'view' })
  const canOnboard = input.tree ? (await checkProductOnboardPermission(event)).allowed : false
  const expiresAt = Date.now() + 15000
  const scope = compileFoundationProductScope({ grants: snapshot.grants, required: { appCode: 'aims', resourceCode: 'products', action: 'view' }, policyOf: () => snapshot.actionPolicy }, uid)
  if (!scope) throw createError({ statusCode: 503, message: '产品授权范围过大或格式不支持，请检查授权配置' })
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, '/v1/aims/internal/product-list', {
    appCode: 'aims', method: 'POST', scope: 'aims.read aims:products:view', query: { current_user: uid },
    body: { input, authorization: { actor_uid: uid, resource: 'products', action: 'view', expires_at: expiresAt, can_onboard: canOnboard, ...scope } }
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品列表运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
})
