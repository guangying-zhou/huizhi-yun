export function usePermissions() {
  const {
    loadAuthorization,
    hasPermission,
    hasRole,
    filterMenus,
    clearAuthorizationCache,
    loaded,
    error
  } = usePlatformPermission()

  return {
    loadPermissions: loadAuthorization,
    hasPermission,
    hasRole,
    filterMenus,
    clearCache: clearAuthorizationCache,
    loaded,
    error
  }
}
