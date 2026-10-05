type PermissionAction = 'view' | 'edit' | 'admin'
type AuthorizationSnapshot = {
  uid: string
  roles: string[]
  resources: Record<string, string[]>
}

const emptyAuthorization: AuthorizationSnapshot = {
  uid: '',
  roles: [],
  resources: {}
}

export function usePlatformPermission() {
  const route = useRoute()
  const { currentTenantCode } = useTenantContext()
  const authorization = useState<AuthorizationSnapshot | null>('platform-authorization', () => null)
  const loaded = useState<boolean>('platform-authorization-loaded', () => false)
  const cacheKey = useState<string>('platform-authorization-cache-key', () => '')

  function resolveScope() {
    return route.path.startsWith('/dashboard') ? 'dashboard' : 'admin'
  }

  function resolveTenantCode() {
    return String(toValue(currentTenantCode) || '').trim()
  }

  async function loadAuthorization() {
    const scope = resolveScope()
    const tenantCode = resolveTenantCode()
    const nextCacheKey = `${scope}:${tenantCode}`

    if (loaded.value && cacheKey.value === nextCacheKey) {
      return authorization.value
    }

    try {
      const fetchJson = $fetch as <T>(request: string, options?: {
        query?: Record<string, string | undefined>
      }) => Promise<T>
      const response = await fetchJson<{
        success?: boolean
        data?: AuthorizationSnapshot
      }>('/api/platform/console/authorization', {
        query: {
          scope,
          tenantCode: tenantCode || undefined
        }
      })

      authorization.value = response.data || emptyAuthorization
    } catch {
      authorization.value = emptyAuthorization
    } finally {
      loaded.value = true
      cacheKey.value = nextCacheKey
    }

    return authorization.value
  }

  function getAuthorization() {
    return authorization.value
  }

  function hasPermission(resource: string, action: PermissionAction = 'view'): boolean {
    const snapshot = getAuthorization()
    if (!snapshot || !loaded.value) return true

    const actions = snapshot.resources?.[resource] || []
    if (action === 'view') {
      return actions.includes('view') || actions.includes('edit') || actions.includes('admin')
    }
    if (action === 'edit') {
      return actions.includes('edit') || actions.includes('admin')
    }

    return actions.includes(action)
  }

  function hasRole(roleCode: string): boolean {
    const snapshot = getAuthorization()
    if (!snapshot || !loaded.value) return true
    return snapshot.roles.includes(roleCode)
  }

  function clearAuthorizationCache() {
    authorization.value = null
    loaded.value = false
    cacheKey.value = ''
  }

  return {
    loadAuthorization,
    hasPermission,
    hasRole,
    clearAuthorizationCache,
    loaded
  }
}
