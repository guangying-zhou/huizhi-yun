type PeoplePermissionAction = 'view' | 'edit' | 'approve' | 'admin'

type PeopleAuthorizationRoleOption = {
  roleCode?: string | null
}

type PeopleAuthorizationSnapshot = {
  uid?: string | null
  roles?: string[]
  availableRoles?: PeopleAuthorizationRoleOption[]
  activeRoleCode?: string | null
  resources?: Record<string, string[]>
}

function hasPermissionInSnapshot(
  snapshot: PeopleAuthorizationSnapshot | null | undefined,
  resource: string,
  action: PeoplePermissionAction = 'view'
) {
  const actions = snapshot?.resources?.[resource] || []
  if (action === 'view') {
    return actions.includes('view') || actions.includes('edit') || actions.includes('admin')
  }
  if (action === 'edit') {
    return actions.includes('edit') || actions.includes('admin')
  }

  return actions.includes(action)
}

export function usePeopleAuthorization() {
  const { loadPermissions } = usePermissions()

  async function ensurePeoplePermission(resource: string, action: PeoplePermissionAction = 'view') {
    const initialSnapshot = await loadPermissions() as PeopleAuthorizationSnapshot
    if (hasPermissionInSnapshot(initialSnapshot, resource, action)) {
      return {
        authorized: true,
        snapshot: initialSnapshot,
        switchedRoleCode: ''
      }
    }

    if (!initialSnapshot?.uid) {
      return {
        authorized: false,
        snapshot: initialSnapshot,
        switchedRoleCode: ''
      }
    }

    const triedRoleCodes = new Set<string>(
      [
        initialSnapshot.activeRoleCode,
        ...(initialSnapshot.roles || [])
      ].map(roleCode => String(roleCode || '').trim()).filter(Boolean)
    )

    for (const role of initialSnapshot.availableRoles || []) {
      const roleCode = String(role.roleCode || '').trim()
      if (!roleCode || triedRoleCodes.has(roleCode)) continue
      triedRoleCodes.add(roleCode)

      const nextSnapshot = await loadPermissions({ activeRoleCode: roleCode, force: true }) as PeopleAuthorizationSnapshot
      if (hasPermissionInSnapshot(nextSnapshot, resource, action)) {
        return {
          authorized: true,
          snapshot: nextSnapshot,
          switchedRoleCode: roleCode
        }
      }
    }

    return {
      authorized: false,
      snapshot: initialSnapshot,
      switchedRoleCode: ''
    }
  }

  return {
    ensurePeoplePermission
  }
}
