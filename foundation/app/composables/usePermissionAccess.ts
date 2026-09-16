export function usePermissionAccess() {
  const { hasPermission, hasRole, loadAuthorization, loaded } = usePlatformPermission()

  return {
    hasPermission,
    hasRole,
    loadPermission: loadAuthorization,
    loaded
  }
}
