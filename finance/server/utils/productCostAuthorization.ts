import { createError, type H3Event } from 'h3'
import { loadSubjectScopedAuthorizationByService } from '@hzy/foundation/server/utils/subjectScopedAuthorization'
import { financeProjectAccountingScopeQuery } from './financeScopedAuthorization'

// Call only after verifying signed actor delegation and tenant/deployment.
export async function resolveProductCostAuthorization(event: H3Event, actorUid: string) {
  return resolveProductCostScope(event, actorUid, 'view')
}

export async function resolveProductCostRulesAuthorization(event: H3Event, actorUid: string) {
  return resolveProductCostScope(event, actorUid, 'edit')
}

async function resolveProductCostScope(event: H3Event, actorUid: string, action: 'view' | 'edit') {
  const snapshot = await loadSubjectScopedAuthorizationByService({
    event, subjectUid: actorUid, purpose: action === 'edit' ? 'product_cost_rules_edit' : 'product_cost_read', resourceCode: 'project_accounting', action
  })
  if (snapshot.uid !== actorUid || snapshot.appCode !== 'finance' || snapshot.authorizationMode !== 'merged') {
    throw createError({ statusCode: 503, message: '产品成本授权主体不匹配' })
  }
  const query = financeProjectAccountingScopeQuery(snapshot, action)
  if (query.current_user_project_finance_access === 'none') {
    throw createError({ statusCode: 403, message: action === 'edit' ? '无权编辑项目产品分摊规则' : '无权查看项目经营成本' })
  }
  return { current_user: actorUid, ...query }
}
