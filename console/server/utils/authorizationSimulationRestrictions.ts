export interface AuthorizationSimulationPermissionRestriction {
  resourceCode: string
  action: string
  reason: string
}

interface RestrictedResourceRule {
  resourceCode: string
  actions: string[]
  reason: string
}

const restrictedResourceRules: RestrictedResourceRule[] = [
  {
    resourceCode: 'credential_vault',
    actions: ['edit', 'admin'],
    reason: 'credential vault write, reveal, or rotation'
  },
  {
    resourceCode: 'service_clients',
    actions: ['edit', 'admin'],
    reason: 'service client credential management'
  },
  {
    resourceCode: 'integration_config',
    actions: ['edit', 'admin'],
    reason: 'external integration and credential configuration'
  },
  {
    resourceCode: 'directory_users',
    actions: ['edit', 'admin'],
    reason: 'employee directory data modification'
  },
  {
    resourceCode: 'directory_departments',
    actions: ['edit', 'admin'],
    reason: 'organization structure modification'
  },
  {
    resourceCode: 'directory_sources',
    actions: ['edit', 'admin'],
    reason: 'directory source and credential configuration'
  },
  {
    resourceCode: 'directory_sync',
    actions: ['edit', 'admin'],
    reason: 'directory synchronization can modify employee data'
  },
  {
    resourceCode: 'system_settings',
    actions: ['admin'],
    reason: 'runtime control'
  }
]

const restrictedActionReasons: Record<string, string> = {
  'approve': 'approval is a high-risk workflow action',
  'close': 'close is a high-risk lifecycle action',
  'confirm': 'confirmation is a high-risk business action',
  'deploy': 'deployment is prohibited during simulation',
  'export': 'data export is prohibited during simulation',
  'impersonate': 'impersonation is prohibited during simulation',
  'manage-credentials': 'credential management is prohibited during simulation',
  'manage_credentials': 'credential management is prohibited during simulation',
  'pay': 'payment is prohibited during simulation',
  'reconcile': 'reconciliation is prohibited during simulation',
  'reopen': 'reopen is a high-risk lifecycle action'
}

function normalize(value: unknown) {
  return String(value || '').trim()
}

function actionMatches(ruleActions: string[], action: string) {
  return ruleActions.includes(action) || (action === 'admin' && ruleActions.includes('edit'))
}

export function getAuthorizationSimulationPermissionRestriction(
  resourceCode: unknown,
  action: unknown
): AuthorizationSimulationPermissionRestriction | null {
  const normalizedResourceCode = normalize(resourceCode)
  const normalizedAction = normalize(action || 'admin')
  if (!normalizedResourceCode || !normalizedAction) return null

  const sensitiveActionReason = restrictedActionReasons[normalizedAction]
  if (sensitiveActionReason) {
    return {
      resourceCode: normalizedResourceCode,
      action: normalizedAction,
      reason: sensitiveActionReason
    }
  }

  const resourceRule = restrictedResourceRules.find(rule =>
    rule.resourceCode === normalizedResourceCode && actionMatches(rule.actions, normalizedAction)
  )
  if (!resourceRule) return null

  return {
    resourceCode: normalizedResourceCode,
    action: normalizedAction,
    reason: resourceRule.reason
  }
}

export function isAuthorizationSimulationPermissionRestricted(resourceCode: unknown, action: unknown) {
  return Boolean(getAuthorizationSimulationPermissionRestriction(resourceCode, action))
}
