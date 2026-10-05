import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import type { PermissionAction } from '~/config/permissions'

// 动作集合以 app/config/permissions.ts 为唯一事实源；两处各维护一份会
// 在新增动作时漏改一边。
type PeoplePermissionAction = PermissionAction

type PeopleAuthorizationSnapshot = {
  uid?: string | null
  roles?: string[]
  resources?: Record<string, string[]>
  actionPolicies?: Record<string, { implications: Record<string, string[]> }>
}

function hasPermissionInSnapshot(
  snapshot: PeopleAuthorizationSnapshot | null | undefined,
  resource: string,
  action: PeoplePermissionAction = 'view'
) {
  return authorizationResourcesAllow(
    snapshot?.resources,
    resource,
    action,
    snapshot?.actionPolicies?.[resource]
  )
}

export function usePeopleAuthorization() {
  const { loadPermissions } = usePermissions()

  async function ensurePeoplePermission(resource: string, action: PeoplePermissionAction = 'view') {
    const initialSnapshot = await loadPermissions() as PeopleAuthorizationSnapshot

    return {
      authorized: hasPermissionInSnapshot(initialSnapshot, resource, action),
      snapshot: initialSnapshot,
      switchedRoleCode: ''
    }
  }

  return {
    ensurePeoplePermission
  }
}
