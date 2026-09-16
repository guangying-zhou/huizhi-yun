import { createError, getHeader, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { hasProductControlCharacter, productCommandKey, workspaceChangeInput, type WorkspaceAction } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductWorkspace(event: H3Event, action: WorkspaceAction) {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || hasProductControlCharacter(code) || code.includes('/')) {
    throw createError({ statusCode: 400, message: '无效的产品编码' })
  }
  const key = action === 'view' ? undefined : productCommandKey(getHeader(event, 'Idempotency-Key'))
  if (action !== 'view' && !key) throw createError({ statusCode: 400, message: '请提供有效的 Idempotency-Key' })
  const input = action === 'view' ? undefined : workspaceChangeInput(action, await readBody(event))
  if (action !== 'view' && !input) throw createError({ statusCode: 400, message: '产品空间字段或版本号无效' })
  const facts = await requireProductPermission(event, code, 'products', action)
  const authorization = {
    resource: 'products', action, facts, expires_at: Date.now() + 15000
  }
  // Construct a fresh body. The browser never supplies decision facts, actor,
  // capability, product code, archive state or a runtime operation name.
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown, message?: string }>(event,
    `/v1/aims/internal/products/${encodeURIComponent(code)}/workspace:${action}`, {
      appCode: 'aims', method: 'POST', scope: `aims.${action === 'view' ? 'read' : 'write'} aims:products:${action}`,
      query: { current_user: facts.actor_uid },
      ...(key ? { idempotencyKey: key } : {}),
      body: { authorization, ...(input ? { input } : {}) }
    })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
