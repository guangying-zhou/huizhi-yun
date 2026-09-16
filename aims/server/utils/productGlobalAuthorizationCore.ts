import { evaluateFoundationScopedAuthorization, type FoundationScopedAuthorizationGrant, type FoundationScopedAuthorizationInput } from '@hzy/foundation/server/utils/scopeEvaluator'

type ResourceActionPolicy = ReturnType<NonNullable<FoundationScopedAuthorizationInput['policyOf']>>

// Onboarding explicitly requires tenant-global scope. An empty legacy scope
// or a product manager relation does not authorize creation of other spaces.
export function productGlobalOnboardDecision(grants: FoundationScopedAuthorizationGrant[], actionPolicy?: ResourceActionPolicy) {
  const globalGrants = grants.filter((grant) => {
    const scopes = [...(grant.defaultScopes || []), ...(grant.assignmentScopes || []), ...(grant.scopes || [])]
    return scopes.length > 0 && scopes.every(scope => scope.dimension === 'tenant' && scope.predicate === 'global')
  })
  return evaluateFoundationScopedAuthorization({ grants: globalGrants, required: { appCode: 'aims', resourceCode: 'products', action: 'onboard' }, policyOf: () => actionPolicy })
}
