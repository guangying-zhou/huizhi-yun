import { createError, type H3Event } from 'h3'
import { requireFoundationSessionUid } from '@hzy/foundation/server/utils/authIdentity'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { appCode } from '~~/app/config/permissions'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import type { PermissionAction } from '~~/app/config/permissions'

interface PermissionSnapshot {
  uid?: string | null
  resources?: Record<string, string[]>
  actionPolicies?: Record<string, { implications: Record<string, string[]> }>
}

// 动作集合以 app/config/permissions.ts 为唯一事实源。
type PeoplePermissionAction = PermissionAction

function hasPermission(snapshot: PermissionSnapshot, resource: string, action: PeoplePermissionAction) {
  return authorizationResourcesAllow(
    snapshot.resources,
    resource,
    action,
    snapshot.actionPolicies?.[resource]
  )
}

export function peoplePermissionSnapshotAllows(
  snapshot: PermissionSnapshot,
  resource: string,
  action: PeoplePermissionAction
) {
  return hasPermission(snapshot, 'admin', 'admin') || hasPermission(snapshot, resource, action)
}

export async function assertPeoplePermission(event: H3Event, resource: string, action: PeoplePermissionAction) {
  const uid = await requireFoundationSessionUid(event, 'People operation requires login')
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(uid, appCode, event)

  if (!peoplePermissionSnapshotAllows(snapshot, resource, action)) {
    throw createError({
      statusCode: 403,
      message: `People operation requires ${resource}/${action} permission`
    })
  }

  return snapshot
}
