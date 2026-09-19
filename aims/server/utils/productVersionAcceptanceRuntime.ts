import type { ProductCommandBridge } from './productCommandBridge'
import type { ProductVersionAcceptancePreview } from '../../app/types/productVersionAcceptance'
import { filterProductVersionExecution, requireCompleteProductExecutionVisibility } from './productVersionExecutionVisibility'
import { checkAimsScopedPermission, resolveAimsProjectAuthorizationObject } from './aimsScopedAuthorization'
import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { productVersionID } from './productVersionInput'
import { productVersionArchiveInput } from './productVersionArchiveInput'
import { productVersionReopenInput } from './productVersionReopenInput'
import { productVersionPublishInput } from './productVersionPublishInput'
import { productRequestPageInput } from './productRequestInput'
import { productVersionAcceptanceInput } from './productVersionAcceptanceInput'
import { hasProductControlCharacter, productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductVersionAcceptance(event: H3Event, action: 'preview' | 'accept' | 'list' | 'view' | 'publish' | 'reopen' | 'archive' | 'delete', bridge?: ProductCommandBridge) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (bridge && !['reopen', 'archive', 'delete', 'preview', 'accept', 'publish', 'list', 'view'].includes(action)) throw createError({ statusCode: 503, message: '统一版本发布验收操作尚未启用' })
  const code = getRouterParam(event, 'productCode') || ''
  const id = productVersionID(getRouterParam(event, 'versionId'))
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code) || id === null || (action !== 'list' && Object.keys(getQuery(event)).length)) throw createError({ statusCode: 400, message: '验收请求标识或查询参数无效' })
  const query = getQuery(event)
  const page = action === 'list' && !Object.keys(query).some(key => !['page', 'pageSize'].includes(key)) ? productRequestPageInput(query) : null
  const acceptanceID = action === 'view' ? productVersionID(getRouterParam(event, 'acceptanceId')) : null
  if ((action === 'list' && !page) || (action === 'view' && acceptanceID === null)) throw createError({ statusCode: 400, message: '验收记录查询参数无效' })
  const writing = action === 'delete' || action === 'archive' || action === 'accept' || action === 'publish' || action === 'reopen'
  const key = writing ? productCommandKey(getHeader(event, 'Idempotency-Key')) : undefined
  if (writing && !key) throw createError({ statusCode: 400, message: '版本操作需要幂等键' })
  const input = action === 'archive' || action === 'delete' ? productVersionArchiveInput(await readBody(event), id) : action === 'reopen' ? productVersionReopenInput(await readBody(event), id) : action === 'publish' ? productVersionPublishInput(await readBody(event), id) : action === 'list' ? { version_id: id, page: page!.page, page_size: page!.page_size } : action === 'view' ? { version_id: id, acceptance_id: acceptanceID } : action === 'preview' ? { version_id: id } : productVersionAcceptanceInput(await readBody(event), id)
  if (!input) throw createError({ statusCode: 400, message: action === 'publish' ? '发布依据、原因或版本信息无效' : '验收核验项、例外或版本信息无效' })
  const permission = writing ? action : 'view'
  const facts = await requireProductPermission(event, code, 'product_versions', permission, bridge?.authorizationSource)
  let executionViewFacts = facts
  const canViewProject = async (projectID: number) => {
    const object = await resolveAimsProjectAuthorizationObject(event, { projectId: String(projectID), uid: facts.actor_uid, requireCompleteFacts: true }, bridge
      ? async () => {
        const response = await bridge.call(code, 'execution-project-authorization', {
          input: { version_id: id, project_id: projectID },
          authorization: { resource: 'product_versions', action: 'view', facts: executionViewFacts, expires_at: Date.now() + 15000 }
        })
        if (response.code !== 0) throw runtimeEnvelopeError(response)
        return response.data
      }
      : undefined)
    return await checkAimsScopedPermission(event, { resourceCode: 'projects', action: 'view', object }) && await checkAimsScopedPermission(event, { resourceCode: 'work_items', action: 'view', object })
  }
  let executionReviewHash: string | undefined
  if (action === 'accept' || action === 'publish') {
    const viewFacts = await requireProductPermission(event, code, 'product_versions', 'view', bridge?.authorizationSource)
    executionViewFacts = viewFacts
    const reviewBody = { input: { version_id: id }, authorization: { resource: 'product_versions', action: 'view', facts: viewFacts, expires_at: Date.now() + 15000 } }
    const review = bridge
      ? { handled: true as const, data: await bridge.call(code, 'preview', reviewBody) as { code: number, data: ProductVersionAcceptancePreview } }
      : await maybeCallTenantRuntime<{ code: number, data: ProductVersionAcceptancePreview }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/versions:acceptance-preview`, {
          appCode: 'aims', method: 'POST', scope: 'aims.read aims:product-versions:read', query: { current_user: facts.actor_uid },
          body: reviewBody
        })
    if (!review.handled) throw createError({ statusCode: 503, message: '执行明细核验服务暂不可用' })
    if (review.data.code !== 0) throw runtimeEnvelopeError(review.data)
    await requireCompleteProductExecutionVisibility(review.data.data, canViewProject)
    executionReviewHash = review.data.data.review_hash
    if (typeof executionReviewHash !== 'string' || !/^[0-9a-f]{64}$/.test(executionReviewHash)) throw createError({ statusCode: 503, message: '执行明细核验快照不完整' })
  }
  const body = { input, ...(executionReviewHash ? { execution_review_hash: executionReviewHash } : {}), authorization: { resource: 'product_versions', action: permission, facts, expires_at: Date.now() + 15000 } }
  const runtime = bridge
    ? { handled: true as const, data: await bridge.call(code, action === 'list' || action === 'view' ? `acceptance-${action}` : action, body, key || undefined) }
    : await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/versions:${writing ? action : `acceptance-${action}`}`, {
        appCode: 'aims', method: 'POST', scope: writing ? `aims.write aims:product-versions:${action}` : 'aims.read aims:product-versions:read', query: { current_user: facts.actor_uid }, ...(key ? { idempotencyKey: key } : {}),
        body
      })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  if (action === 'preview') {
    const preview = runtime.data.data as ProductVersionAcceptancePreview
    const visible = await filterProductVersionExecution(preview, canViewProject)
    return { ...runtime.data, data: visible }
  }
  return runtime.data
}
