export function usePermissions() {
  const {
    loadAuthorization,
    hasPermission,
    hasRole,
    filterMenus,
    clearAuthorizationCache,
    loaded
  } = usePlatformPermission()

  return {
    loadPermissions: loadAuthorization,
    hasPermission,
    hasRole,
    filterMenus,
    clearCache: clearAuthorizationCache,
    loaded
  }
}
