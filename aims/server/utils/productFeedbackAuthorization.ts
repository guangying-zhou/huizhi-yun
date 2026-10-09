import { createError, type H3Event } from 'h3'
import { evaluateFoundationProductAuthorization } from '@hzy/foundation/server/utils/scopeEvaluator'
import { loadSubjectScopedAuthorizationByService } from '@hzy/foundation/server/utils/subjectScopedAuthorization'
import { productAuthorizationObject, type ProductAuthorizationFacts } from './productAuthorizationCore'

// The service handler must verify the signed command before supplying actorUid,
// and obtain facts through the command-bound feedback authorization endpoint.
export async function requireProductFeedbackAuthorization(event: H3Event, actorUid: string, productCode: string, facts: ProductAuthorizationFacts) {
  const object = facts && productAuthorizationObject(facts, productCode, actorUid)
  if (!object) throw createError({ statusCode: 503, message: '反馈产品授权事实不一致' })
  const resourceCode = 'product_requests', action = 'create'
  const authorization = await loadSubjectScopedAuthorizationByService({ event, subjectUid: actorUid, purpose: 'product_feedback_create', resourceCode, action })
  // Recheck the subject at the business boundary before evaluating current
  // product facts against the delegated user's scoped grants.
  if (authorization.uid !== actorUid || authorization.appCode !== 'aims') {
    throw createError({ statusCode: 503, message: '反馈原操作者授权快照身份不一致' })
  }
  const decision = evaluateFoundationProductAuthorization({ grants: authorization.grants, required: { appCode: 'aims', resourceCode, action }, object, policyOf: () => authorization.actionPolicy })
  if (!decision.allowed) throw createError({ statusCode: 403, message: '原操作者无权向该产品提交反馈' })
  if (facts.status !== 'active') throw createError({ statusCode: 409, message: '产品空间已归档' })
  return { resource: resourceCode, action, facts, expires_at: Date.now() + 15000 }
}
