export const NOTIFICATION_RUNTIME_CLIENT_CODE = 'notification-runtime'
export const NOTIFICATION_RUNTIME_DEFAULT_INTEGRATION_CODE = 'wecom.default'

export const NOTIFICATION_RUNTIME_REQUIRED_GRANTS = [
  {
    scope: 'integration_config:view',
    resourceCode: 'integration_config',
    action: 'view',
    usageTypes: []
  },
  {
    scope: 'credential_vault:resolve',
    resourceCode: 'credential_vault',
    action: 'resolve',
    usageTypes: ['integration']
  }
] as const

export function notificationRuntimeGrantScopeJson(
  grant: (typeof NOTIFICATION_RUNTIME_REQUIRED_GRANTS)[number],
  source: string
) {
  return {
    source,
    purpose: 'wecom-notification-delivery',
    ...(grant.usageTypes.length ? { usageTypes: [...grant.usageTypes] } : {}),
    integrationCodes: [NOTIFICATION_RUNTIME_DEFAULT_INTEGRATION_CODE]
  }
}
