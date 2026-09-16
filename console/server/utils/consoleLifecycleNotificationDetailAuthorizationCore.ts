export interface ConsoleLifecycleNotificationDescriptor {
  resource: string
  id: string
  bizKey?: string
}

export interface ConsoleLifecyclePermissionDecision {
  authorizationLifecycleView: boolean
  auditLogsView: boolean
  systemSettingsView?: boolean
}

export const CONSOLE_LIFECYCLE_NOTIFICATION_RESOURCE = 'people_lifecycle_authorization'

function text(value: unknown) {
  return String(value || '').trim()
}

export function consoleLifecycleNotificationAuthorizationResult(
  subjectUidInput: string,
  descriptor: ConsoleLifecycleNotificationDescriptor,
  decision: ConsoleLifecyclePermissionDecision
) {
  const subjectUid = text(subjectUidInput)
  const exactDescriptor = Object.keys(descriptor).sort().join(',') === 'id,resource'
    && [CONSOLE_LIFECYCLE_NOTIFICATION_RESOURCE, 'notification_runtime'].includes(descriptor.resource)
    && Boolean(text(descriptor.id))
    && text(descriptor.id) === descriptor.id
  const authorized = Boolean(subjectUid && exactDescriptor && (
    descriptor.resource === CONSOLE_LIFECYCLE_NOTIFICATION_RESOURCE
      ? decision.authorizationLifecycleView && decision.auditLogsView
      : descriptor.resource === 'notification_runtime' && decision.systemSettingsView
  ))
  return {
    authorized,
    reasonCode: authorized ? 'allowed' : 'not_authorized',
    resource: descriptor.resource,
    id: descriptor.id
  }
}
