import type { ProductCommandBridge } from './productCommandBridge'
import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { productVersionID } from './productVersionInput'
import { productModelPageInput } from './productModelInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'
import { filterExecutionCoordination, type ExecutionCoordination } from './productExecutionCoordinationVisibility'
import { checkAimsScopedPermission, resolveAimsProjectAuthorizationObject } from './aimsScopedAuthorization'

export async function handleProductExecutionCoordination(event: H3Event, bridge?: ProductCommandBridge) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'GET') throw createError({ statusCode: 405, message: '只支持读取多项目协调汇总' })
  const code = getRouterParam(event, 'productCode') || ''
  const { versionId: rawVersion, ...query } = getQuery(event)
  const versionId = productVersionID(rawVersion)
  const page = productModelPageInput(query)
  if (!crossDependencyProductCode(code) || versionId === null || !page) throw createError({ statusCode: 400, message: '产品、版本或分页无效' })
  const facts = await requireProductPermission(event, code, 'product_versions', 'view', bridge?.authorizationSource)
  if (facts.product_code !== code) throw createError({ statusCode: 409, message: '产品授权上下文已变化，请刷新' })
  const result = bridge
    ? { handled: true as const, data: await bridge.call(code, 'execution-coordination', { input: { version_id: versionId }, authorization: { resource: 'product_versions', action: 'view', facts, expires_at: Date.now() + 15000 } }) as { code: number, data: ExecutionCoordination } }
    : await maybeCallTenantRuntime<{ code: number, data: ExecutionCoordination }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/versions:execution-coordination`, {
        appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-versions:read', query: { current_user: facts.actor_uid },
        body: { input: { version_id: versionId }, authorization: { resource: 'product_versions', action: 'view', facts, expires_at: Date.now() + 15000 } }
      })
  if (!result.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (result.data.code !== 0) throw runtimeEnvelopeError(result.data)
  const visible = await filterExecutionCoordination(result.data.data, code, versionId, page.page, page.page_size, async (projectID) => {
    const object = await resolveAimsProjectAuthorizationObject(event, { projectId: String(projectID), uid: facts.actor_uid, requireCompleteFacts: true }, bridge
      ? async () => {
        const response = await bridge.call(code, 'execution-project-authorization', { input: { version_id: versionId, project_id: projectID }, authorization: { resource: 'product_versions', action: 'view', facts, expires_at: Date.now() + 15000 } })
        if (response.code !== 0) throw runtimeEnvelopeError(response)
        return response.data
      }
      : undefined)
    return await checkAimsScopedPermission(event, { resourceCode: 'projects', action: 'view', object }) && await checkAimsScopedPermission(event, { resourceCode: 'work_items', action: 'view', object })
  })
  return { code: 0, data: visible }
}
