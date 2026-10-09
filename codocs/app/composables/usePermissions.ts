import type { MenuItem } from '~/config/permissions'
import type {
  AccountRole,
  PermissionAction
} from '~/types/account'

type FilteredMenuItem = Omit<MenuItem, 'children'> & {
  children?: FilteredMenuItem[]
}

export function usePermissions() {
  const {
    loadAuthorization,
    getAuthorization,
    clearAuthorizationCache,
    loaded,
    loading
  } = useAuthorization()
  const platformPermission = usePlatformPermission()

  const permissions = computed<Record<string, PermissionAction[]>>(() => {
    return (getAuthorization()?.resources || {}) as Record<string, PermissionAction[]>
  })

  const roles = computed<AccountRole[]>(() => {
    return (getAuthorization()?.roles || []).map((roleCode: string) => ({
      code: roleCode,
      name: roleCode
    }))
  })

  /**
   * 检查当前用户是否有指定资源的指定操作权限
   * @param resource 资源编码（不含 appCode 前缀）
   * @param action 操作类型，默认 'view'
   */
  function hasPermission(resource: string, action: PermissionAction = 'view'): boolean {
    return platformPermission.hasPermission(resource, action)
  }

  /**
   * 检查用户是否有指定角色
   */
  function hasRole(roleCode: string): boolean {
    return platformPermission.hasRole(roleCode)
  }

  /**
   * 根据权限过滤菜单树
   * 递归处理，保留有权限的菜单项
   */
  function filterMenus(menuGroups: MenuItem[][]): FilteredMenuItem[][] {
    type PlatformMenuGroups = Parameters<typeof platformPermission.filterMenus>[0]
    return platformPermission.filterMenus(menuGroups as unknown as PlatformMenuGroups) as FilteredMenuItem[][]
  }

  return {
    permissions,
    roles,
    loaded,
    loading,
    loadPermissions: loadAuthorization,
    hasPermission,
    hasRole,
    filterMenus,
    clearCache: clearAuthorizationCache
  }
}
