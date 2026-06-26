interface CachedDeptTreeNode {
  deptCode: string
  name: string
  orgType?: string
  children?: CachedDeptTreeNode[]
}

interface UserDepartmentsCacheData {
  departments: CachedDeptTreeNode[]
  primaryDeptCode: string | null
}

export function useUserDepartmentsCache() {
  const { user } = useAuth()
  const cacheState = useState<UserDepartmentsCacheData | null>('user-departments-cache', () => null)
  const cacheKey = computed(() => `auth_user_departments:${String(user.value || 'anonymous').trim() || 'anonymous'}`)

  const normalize = (data: Partial<UserDepartmentsCacheData> | null | undefined): UserDepartmentsCacheData | null => {
    if (!data) return null
    return {
      departments: Array.isArray(data.departments) ? data.departments : [],
      primaryDeptCode: typeof data.primaryDeptCode === 'string' ? data.primaryDeptCode : null
    }
  }

  const hydrateDepartmentsCache = () => {
    if (!import.meta.client || cacheState.value) return cacheState.value

    try {
      const raw = localStorage.getItem(cacheKey.value)
      if (!raw) return null
      const parsed = normalize(JSON.parse(raw) as Partial<UserDepartmentsCacheData>)
      cacheState.value = parsed
      return parsed
    } catch {
      return null
    }
  }

  const setDepartmentsCache = (data: Partial<UserDepartmentsCacheData> | null | undefined) => {
    const normalized = normalize(data)
    cacheState.value = normalized

    if (!import.meta.client) return

    try {
      if (!normalized) {
        localStorage.removeItem(cacheKey.value)
      } else {
        localStorage.setItem(cacheKey.value, JSON.stringify(normalized))
      }
    } catch { /* localStorage may be unavailable */ }
  }

  const clearDepartmentsCache = () => {
    cacheState.value = null
    if (!import.meta.client) return
    try {
      localStorage.removeItem(cacheKey.value)
    } catch { /* localStorage may be unavailable */ }
  }

  hydrateDepartmentsCache()

  const departmentsCache = computed<UserDepartmentsCacheData | null>(() => {
    return cacheState.value || hydrateDepartmentsCache()
  })

  return {
    departmentsCache,
    hydrateDepartmentsCache,
    setDepartmentsCache,
    clearDepartmentsCache
  }
}
