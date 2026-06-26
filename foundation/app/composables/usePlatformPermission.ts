import { createCapabilityState, filterNavigationItems, type PlatformCapabilityMap, type PlatformCapabilityValue, type PlatformNavigationItem } from '@hzy/platform-adapter-nuxt'

type PermissionAction = string
type LegacyAuthorizationSnapshot = {
  uid: string
  roles: string[]
  resources: Record<string, string[]>
}

export type PermissionMenuItem = {
  resource?: string
  resourceCode?: string
  action?: PermissionAction
  children?: PermissionMenuItem[]
  type?: string
  [key: string]: unknown
}

export function usePlatformPermission() {
  const config = useRuntimeConfig()
  const pub = config.public as Record<string, unknown>
  const appCode = String(pub.appCode || pub.appName || '')
  const { loadAuthorization, getAuthorization, clearAuthorizationCache, loaded } = useAuthorization()
  const capabilityState = createCapabilityState({
    authorization: () => getAuthorization(),
    resolver: (authorization: LegacyAuthorizationSnapshot | null | undefined): PlatformCapabilityMap => {
      if (!authorization) {
        return {}
      }

      const capabilities: PlatformCapabilityMap = {}

      for (const roleCode of authorization.roles) {
        capabilities[`role:${roleCode}`] = true
      }

      const resources = authorization.resources || {}

      for (const [resourceCode, actions] of Object.entries(resources)) {
        for (const action of actions) {
          capabilities[`permission:${appCode}:${resourceCode}:${action}`] = true
        }
      }

      return capabilities
    }
  })

  function hasPermission(resource: string, action: PermissionAction = 'view'): boolean {
    const authorization = getAuthorization()
    if (!authorization) return false

    const actions = authorization.resources?.[resource] || []
    if (action === 'view') {
      return actions.includes('view') || actions.includes('edit') || actions.includes('admin')
    }
    if (action === 'edit') {
      return actions.includes('edit') || actions.includes('admin')
    }

    return actions.includes(action)
  }

  function hasRole(roleCode: string): boolean {
    const authorization = getAuthorization()
    if (!authorization) return false
    return authorization.roles.includes(roleCode)
  }

  function hasCapability(key: string, expected: PlatformCapabilityValue = true) {
    return capabilityState.hasCapability(key, expected)
  }

  function filterMenus(menuGroups: PermissionMenuItem[][]): PermissionMenuItem[][] {
    return menuGroups.map(group => filterNavigationItems(normalizeNavigationItems(group), {
      hasPermission: (resourceCode, action) => hasPermission(resourceCode, (action as PermissionAction) || 'view'),
      hasCapability
    }) as PermissionMenuItem[])
  }

  function normalizeNavigationItems(items: PermissionMenuItem[]): PlatformNavigationItem<PermissionMenuItem>[] {
    return items.map(item => ({
      ...item,
      resourceCode: item.resourceCode || item.resource,
      children: item.children ? normalizeNavigationItems(item.children) : undefined
    }) as PlatformNavigationItem<PermissionMenuItem>)
  }

  return {
    loadAuthorization,
    hasPermission,
    hasRole,
    hasCapability,
    capabilities: capabilityState.capabilities,
    filterMenus,
    clearAuthorizationCache,
    loaded
  }
}
