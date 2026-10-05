import type { FoundationScopedAuthorizationGrant } from './scopeEvaluator'

export interface IntegrationOperationAdminRequirement {
  appCode: string
  action: 'view' | 'replay'
}

export function hasTenantGlobalIntegrationOperationGrant(
  grants: FoundationScopedAuthorizationGrant[] = [],
  requirement: IntegrationOperationAdminRequirement
) {
  return grants.some((grant) => {
    const hasPermission = grant.permissions.some(permission =>
      permission.appCode === requirement.appCode
      && permission.resourceCode === 'integration_operations'
      && permission.action === requirement.action
    )
    if (!hasPermission) return false

    return [grant.defaultScopes || [], grant.assignmentScopes || [], grant.scopes || []]
      .flat()
      .every(scope => scope.dimension === 'tenant' && scope.predicate === 'global')
  })
}
