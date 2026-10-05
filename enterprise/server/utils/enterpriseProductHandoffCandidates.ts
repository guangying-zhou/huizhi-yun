import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { requireProductPermission } from '../../../aims/server/utils/productAuthorization'
import { checkAimsScopedPermission } from '../../../aims/server/utils/aimsScopedAuthorization'
import { productHandoffProjectObject, type ProductHandoffProjectFacts } from '../../../aims/server/utils/productHandoffProjectAuthorizationCore'
import { productRequestPageInput } from '../../../aims/server/utils/productRequestInput'
import { hasProductControlCharacter } from '../../../aims/server/utils/productWorkspaceInput'
import { runtimeEnvelopeError } from '../../../aims/server/utils/aimsRuntimeForward'
import { enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { enterpriseProductHandoffBridge } from './enterpriseProductHandoff'

export async function enterpriseHandoffCandidates(event: H3Event, action: 'projects' | 'requirements') {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || '', query = getQuery(event)
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code) || Object.keys(query).some(k => !['page', 'pageSize', 'search', ...(action === 'requirements' ? ['projectCode'] : [])].includes(k))) throw createError({ statusCode: 400, message: '项目承接查询无效' })
  const page = productRequestPageInput({ page: query.page, pageSize: query.pageSize, keyword: query.search })
  const projectCode = action === 'requirements' ? String(query.projectCode || '') : ''
  if (!page || (action === 'requirements' && (!projectCode || projectCode !== projectCode.trim() || [...projectCode].length > 64 || hasProductControlCharacter(projectCode)))) throw createError({ statusCode: 400, message: '项目承接分页或项目无效' })
  const bridge = await enterpriseProductHandoffBridge(event), facts = await requireProductPermission(event, code, 'product_priorities', 'view', bridge.authorizationSource)
  const response = await bridge.call(code, action, { input: { keyword: page.keyword, ...(projectCode ? { project_code: projectCode } : {}) }, authorization: { resource: 'product_priorities', action: 'view', facts, expires_at: enterpriseRuntimePermitExpiresAt() } })
  if (response.code !== 0) throw runtimeEnvelopeError(response)
  const allowed = async (projectFacts: ProductHandoffProjectFacts, expectedCode: string, resource: string) => {
    const object = productHandoffProjectObject(projectFacts, expectedCode, facts.actor_uid)
    if (!object) throw createError({ statusCode: 503, message: '项目授权事实不完整' })
    return checkAimsScopedPermission(event, { resourceCode: resource, action: 'view', object })
  }
  let items: Record<string, unknown>[] = []
  if (action === 'projects') {
    if (!Array.isArray(response.data)) throw createError({ statusCode: 503, message: '候选项目响应不完整' })
    for (const item of response.data) {
      if (!item || item.category !== 'product_dev' || item.lifecycle_status !== 'active' || item.id !== item.facts?.project_id || typeof item.name !== 'string') throw createError({ statusCode: 503, message: '候选项目事实不完整' })
      if (await allowed(item.facts, item.project_code, 'projects')) {
        const { facts: _facts, ...record } = item
        items.push(record)
      }
    }
  } else {
    const value = response.data as { facts: ProductHandoffProjectFacts, items: Record<string, unknown>[] }
    if (!value || !Array.isArray(value.items)) throw createError({ statusCode: 503, message: '候选需求响应不完整' })
    if (!await allowed(value.facts, projectCode, 'requirements')) throw createError({ statusCode: 403, message: '没有项目需求查看权限' })
    if (value.items.some(item => item.project_id !== value.facts.project_id || !Number.isSafeInteger(item.id) || typeof item.title !== 'string')) throw createError({ statusCode: 503, message: '候选需求归属不完整' })
    items = value.items
  }
  return { code: 0, data: { items: items.slice((page.page - 1) * page.page_size, page.page * page.page_size), total: items.length, page: page.page, pageSize: page.page_size } }
}
