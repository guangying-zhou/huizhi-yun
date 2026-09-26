import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { checkProductPermission } from '../../../aims/server/utils/productAuthorization'
import { enterpriseProductAuthorizationSource } from './enterpriseProductAuthorization'

const projectPattern = /^[1-9][0-9]{0,17}$/
const productPattern = /^[^/\p{Cc}]{1,64}$/u

async function projectContext(event: H3Event, action: 'view' | 'edit') {
  setHeader(event, 'Cache-Control', 'no-store')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '项目产品关联不接受查询参数' })
  const projectId = getRouterParam(event, 'id') || ''
  if (!projectPattern.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: '项目标识无效' })
  const user = await requireEnterpriseUser(event)
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'aims', { resourceCode: 'projects', action })
  if (scoped.decision?.allowed !== true) throw createError({ statusCode: 403, message: '当前用户没有项目权限' })
  return { user, projectId, authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'projects', action, projectId, allowed: true, expiresAt: enterpriseRuntimePermitExpiresAt() } }
}

export async function enterpriseAimsProjectProducts(event: H3Event) {
  const { user, projectId, authorization } = await projectContext(event, 'view')
  await prepareEnterpriseRuntime(event, 'aims.project-products-list')
  const result = await callEnterpriseRuntime<{ code: number, data?: { items?: Record<string, unknown>[] } }>(event, 'aims.project-products-list', { tenant: user.tenant, deployment: user.deployment, projectId, authorization })
  if (result.code !== 0 || !Array.isArray(result.data?.items)) throw createError({ statusCode: 503, message: '项目产品列表响应无效' })
  return { code: 0, data: { items: result.data.items.map(row => ({ product_code: row.product_code, is_primary: row.is_primary, version_id: row.version_id })) } }
}

export async function enterpriseAimsProjectProductLink(event: H3Event) {
  const key = String(getHeader(event, 'Idempotency-Key') || '').trim()
  if (!key || key.length > 191) throw createError({ statusCode: 400, message: '缺少有效操作标识' })
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.productCode !== 'string' || !productPattern.test(body.productCode) || body.productCode !== body.productCode.trim()) throw createError({ statusCode: 400, message: '产品编码无效' })
  const { user, projectId, authorization } = await projectContext(event, 'edit')
  const source = await enterpriseProductAuthorizationSource(event)
  const product = await checkProductPermission(event, body.productCode, 'products', 'view', source)
  if (!product.allowed) throw createError({ statusCode: 404, message: '产品不存在或不可见' })
  await prepareEnterpriseRuntime(event, 'aims.project-products-link')
  const response = await callEnterpriseRuntime<{ code: number, data?: { result?: { projectId?: number, productCode?: string } } }>(event, 'aims.project-products-link', {
    tenant: user.tenant, deployment: user.deployment, projectId, productCode: body.productCode, authorization,
    productAuthorization: { resource: 'products', action: 'view', facts: product.facts, expires_at: enterpriseRuntimePermitExpiresAt() }
  }, { idempotencyKey: key })
  if (response.code !== 0 || response.data?.result?.productCode !== body.productCode || response.data.result.projectId !== Number(projectId)) throw createError({ statusCode: 503, message: '项目产品关联响应无效' })
  return response
}
