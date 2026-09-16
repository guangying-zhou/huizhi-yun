import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { checkProductPermission, requireProductPermission } from './productAuthorization'
import {
  productLightweightPlanConfirmInput,
  productLightweightPlanEditInput,
  productLightweightPlanIDs,
  productLightweightPlanItemCreateInput,
  productLightweightPlanItemDeleteInput,
  productLightweightPlanItemEditInput,
  productLightweightPlanItemPageInput
} from './productLightweightPlanInput'
import { hasProductControlCharacter, productCommandKey } from './productWorkspaceInput'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

type PlanAction = 'read' | 'edit' | 'item-list' | 'item-create' | 'item-edit' | 'item-delete' | 'confirm'

function camelCaseKey(key: string) {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

/** Runtime structs deliberately use snake_case; browser contracts use camelCase. */
export function camelCaseRuntimeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelCaseRuntimeValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [camelCaseKey(key), camelCaseRuntimeValue(child)]))
}

export async function handleProductLightweightPlan(event: H3Event, action: PlanAction): Promise<{ code: number, data: unknown }> {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  const ids = productLightweightPlanIDs(getRouterParam(event, 'versionId'), action === 'item-edit' || action === 'item-delete' ? getRouterParam(event, 'scopeId') : undefined)
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code) || !ids) throw createError({ statusCode: 400, message: '产品、版本或范围标识无效' })
  const reading = action === 'read' || action === 'item-list'
  const query = getQuery(event)
  if ((action !== 'item-list' && Object.keys(query).length) || (!reading && !productCommandKey(getHeader(event, 'Idempotency-Key')))) throw createError({ statusCode: 400, message: '轻量计划请求或幂等键无效' })
  const parsed = action === 'read'
    ? { version_id: ids.versionID }
    : action === 'item-list'
      ? productLightweightPlanItemPageInput(query)
      : action === 'edit'
        ? productLightweightPlanEditInput(await readBody(event), ids.versionID)
        : action === 'item-create'
          ? productLightweightPlanItemCreateInput(await readBody(event), ids.versionID)
          : action === 'item-edit'
            ? productLightweightPlanItemEditInput(await readBody(event), ids.versionID, ids.scopeID!)
            : action === 'item-delete'
              ? productLightweightPlanItemDeleteInput(await readBody(event), ids.versionID, ids.scopeID!)
              : productLightweightPlanConfirmInput(await readBody(event), ids.versionID)
  if (!parsed) throw createError({ statusCode: 400, message: '轻量计划字段或分页条件无效' })
  const input = action === 'item-list' ? { version_id: ids.versionID, ...parsed } : parsed

  const versionAction = reading ? 'view' : 'edit'
  const versionFacts = await requireProductPermission(event, code, 'product_versions', versionAction)
  const requestFacts = action === 'read' || action === 'item-list' || action === 'item-create'
    ? await requireProductPermission(event, code, 'product_requests', 'view')
    : null
  const requestDecisionFacts = action === 'item-create' && (input as { adopt_request?: unknown }).adopt_request === true
    ? await requireProductPermission(event, code, 'product_requests', 'decide')
    : null
  const planningAction = action === 'item-create' ? 'edit' : action === 'confirm' ? 'prioritize' : null
  const planningFacts = planningAction ? await requireProductPermission(event, code, 'product_priorities', planningAction) : null
  const runtimeAction = action === 'read'
    ? 'plan'
    : action === 'edit'
      ? 'plan-edit'
      : action === 'item-list'
        ? 'plan-items'
        : action === 'item-create' ? 'plan-item-create' : action === 'item-edit' ? 'plan-item-edit' : action === 'item-delete' ? 'plan-item-delete' : 'plan-confirm'
  const key = reading ? undefined : productCommandKey(getHeader(event, 'Idempotency-Key'))!
  const expires = Date.now() + 15000
  const runtime = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, `/v1/aims/internal/products/${encodeURIComponent(code)}/versions:${runtimeAction}`, {
    appCode: 'aims', method: 'POST', scope: reading ? 'aims.read aims:product-versions:read' : 'aims.write aims:product-versions:edit',
    query: { current_user: versionFacts.actor_uid }, ...(key ? { idempotencyKey: key } : {}),
    body: {
      input,
      authorization: { resource: 'product_versions', action: versionAction, facts: versionFacts, expires_at: expires },
      ...(requestFacts ? { request_authorization: { resource: 'product_requests', action: 'view', facts: requestFacts, expires_at: expires } } : {}),
      ...(requestDecisionFacts ? { request_decision_authorization: { resource: 'product_requests', action: 'decide', facts: requestDecisionFacts, expires_at: expires } } : {}),
      ...(planningFacts ? { planning_authorization: { resource: 'product_priorities', action: planningAction, facts: planningFacts, expires_at: expires } } : {})
    }
  })
  if (!runtime.handled) throw createError({ statusCode: 503, message: '产品运行服务暂不可用' })
  if (runtime.data.code !== 0) throw runtimeEnvelopeError(runtime.data)
  const data = camelCaseRuntimeValue(runtime.data.data)
  if (action !== 'read') return { ...runtime.data, data }
  const [versionEdit, priorityEdit, priorityPrioritize, requestDecide, priorityHandoff] = await Promise.all([
    checkProductPermission(event, code, 'product_versions', 'edit'),
    checkProductPermission(event, code, 'product_priorities', 'edit'),
    checkProductPermission(event, code, 'product_priorities', 'prioritize'),
    checkProductPermission(event, code, 'product_requests', 'decide'),
    checkProductPermission(event, code, 'product_priorities', 'handoff')
  ])
  return {
    ...runtime.data,
    data: {
      ...(data as Record<string, unknown>),
      permissions: {
        canEditPlan: versionEdit.allowed,
        canCreateScope: versionEdit.allowed && priorityEdit.allowed,
        canConfirmPlan: versionEdit.allowed && priorityPrioritize.allowed,
        canDecideRequests: requestDecide.allowed,
        canHandoff: priorityHandoff.allowed
      }
    }
  }
}
