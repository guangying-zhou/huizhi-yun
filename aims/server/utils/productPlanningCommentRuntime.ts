import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireProductPermission } from './productAuthorization'
import { productPlanningCommentHistoryInput, productPlanningCommentListInput, productPlanningCommentWriteInput } from './productPlanningCommentInput'
import { hasProductControlCharacter, productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

export async function handleProductPlanningComments(event: H3Event, action: 'history' | 'list' | 'create' | 'edit' | 'delete') {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  const itemID = getRouterParam(event, 'itemId') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const writing = action !== 'list' && action !== 'history'
  const key = writing ? productCommandKey(getHeader(event, 'Idempotency-Key')) : undefined
  if (writing && (!key || Object.keys(getQuery(event)).length)) throw createError({ statusCode: 400, message: '评论操作需要幂等键且不能携带查询参数' })
  const input = action === 'history' ? productPlanningCommentHistoryInput(getQuery(event), itemID, getRouterParam(event, 'commentId') || '') : action === 'list' ? productPlanningCommentListInput(getQuery(event), itemID) : productPlanningCommentWriteInput(await readBody(event), itemID, action, getRouterParam(event, 'commentId'))
  if (!input) throw createError({ statusCode: 400, message: '评论正文、标识或版本信息无效' })
  const permission = writing ? 'comment' : 'view'
  const facts = await requireProductPermission(event, code, 'product_priorities', permission)
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/planning-comments:${action}`, {
    appCode: 'aims', method: 'POST', scope: writing ? 'aims.write aims:product-priorities:comment' : 'aims.read aims:product-priorities:read',
    query: { current_user: facts.actor_uid }, ...(key ? { idempotencyKey: key } : {}),
    body: { input, authorization: { resource: 'product_priorities', action: permission, facts, expires_at: Date.now() + 15000 } }
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  return runtime.data
}
