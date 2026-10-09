import type { H3Event } from 'h3'
import { hasPermissionInSnapshot, loadPolicyAuthorizationSnapshot } from './policyAuthorization'
import { resolveConsoleRuntimeBinding } from './consoleRuntimeBinding'
import { evaluateWithFreshNotificationDetailPolicy } from './notificationDetailFreshPolicy'
import type { NotificationAuthorizationDescriptor } from './notificationDetailContract'
import {
  consoleLifecycleNotificationAuthorizationResult,
  type ConsoleLifecyclePermissionDecision
} from './consoleLifecycleNotificationDetailAuthorizationCore'

interface Dependencies {
  loadPermissionDecision?: (event: H3Event, uid: string) => Promise<ConsoleLifecyclePermissionDecision>
}

function text(value: unknown) {
  return String(value || '').trim()
}

async function loadCurrentPermissions(event: H3Event, uid: string): Promise<ConsoleLifecyclePermissionDecision> {
  const binding = resolveConsoleRuntimeBinding(event)
  const snapshot = await evaluateWithFreshNotificationDetailPolicy(
    event,
    binding,
    async () => await loadPolicyAuthorizationSnapshot(uid, 'console', event, {
      authorizationMode: 'merged',
      ignoreSimulationSession: true,
      allowRoleSimulation: false,
      allowUserSimulation: false,
      allowPrivileged: false,
      bypassSnapshotCache: true
    })
  )
  return {
    authorizationLifecycleView: hasPermissionInSnapshot(snapshot, 'authorization_lifecycle', 'view'),
    auditLogsView: hasPermissionInSnapshot(snapshot, 'audit_logs', 'view'),
    systemSettingsView: hasPermissionInSnapshot(snapshot, 'system_settings', 'view')
  }
}

export async function authorizeConsoleLifecycleNotificationDetail(
  event: H3Event,
  subjectUidInput: string,
  descriptor: NotificationAuthorizationDescriptor,
  dependencies: Dependencies = {}
) {
  const subjectUid = text(subjectUidInput)
  const invalid = consoleLifecycleNotificationAuthorizationResult(subjectUid, descriptor, {
    authorizationLifecycleView: true,
    auditLogsView: true,
    systemSettingsView: true
  })
  if (!invalid.authorized) return invalid
  const decision = await (dependencies.loadPermissionDecision || loadCurrentPermissions)(event, subjectUid)
  return consoleLifecycleNotificationAuthorizationResult(subjectUid, descriptor, decision)
}
