/**
 * 权限 Composable
 *
 * 从自身 API 获取当前用户的资源权限，提供：
 * - hasPermission(resource, action) — 检查是否有指定权限
 * - filterMenus(menus) — 根据权限过滤菜单
 * - userPermissions — 原始权限数据 (响应式)
 */
import { appCode } from '~/config/permissions'
import type { MenuItem } from '~/config/permissions'

interface PermissionResponse {
  code: number
  data?: {
    resources: Record<string, string[]>
    roles: Array<{ code: string, name: string }>
  }
}

// 模块级缓存，避免多次请求
const _permissions = ref<Record<string, string[]>>({})
const _roles = ref<{ code: string, name: string }[]>([])
const _loaded = ref(false)
const _loading = ref(false)

export function usePermissions() {
  const { user: userId } = useAuth()

  /**
   * 加载用户权限
   */
  async function loadPermissions() {
    const uid = userId.value
    if (!uid || _loading.value) return

    _loading.value = true
    try {
      const response = await $fetch<PermissionResponse>('/api/auth/permissions')
      if (response.code === 0 && response.data) {
        _permissions.value = response.data.resources || {}
        _roles.value = response.data.roles || []
        _loaded.value = true
      }
    } catch (error) {
      const err = error as Error
      console.warn('[usePermissions] Failed to load permissions:', err.message)
    } finally {
      _loading.value = false
    }
  }

  /**
   * 检查当前用户是否有指定资源的指定操作权限
   */
  function hasPermission(resource: string, action: 'view' | 'edit' | 'admin' = 'view'): boolean {
    // profile 资源对所有已登录用户默认开放 view
    if (resource === 'profile' && action === 'view') return true

    // 未加载完成前不放行，避免菜单闪烁
    if (!_loaded.value) return false

    const key = `${appCode}:${resource}`
    const actions = _permissions.value[key]
    if (!actions) return false

    // admin 权限隐含 edit 和 view
    if (action === 'view') {
      return actions.includes('view') || actions.includes('edit') || actions.includes('admin')
    }
    if (action === 'edit') {
      return actions.includes('edit') || actions.includes('admin')
    }
    return actions.includes(action)
  }

  /**
   * 检查用户是否有指定角色
   */
  function hasRole(roleCode: string): boolean {
    return _roles.value.some(r => r.code === roleCode)
  }

  /**
   * 根据权限过滤菜单树
   */
  function filterMenus(menuGroups: MenuItem[][]): MenuItem[][] {
    return menuGroups.map(group => filterGroup(group))
  }

  function filterGroup(items: MenuItem[]): MenuItem[] {
    return items
      .filter((item) => {
        if (!item.resource) return true
        const action = item.requiredAction || 'view'
        return hasPermission(item.resource, action)
      })
      .map((item) => {
        const result: MenuItem = { ...item }
        if (item.children) {
          result.children = filterGroup(item.children)
          if (result.children.length === 0 && item.type === 'trigger') {
            return null
          }
        }
        return result
      })
      .filter((item): item is MenuItem => item !== null)
  }

  // 监听用户变化，重新加载权限
  watch(userId, (newUid, oldUid) => {
    if (newUid && newUid !== oldUid) {
      _loaded.value = false
      loadPermissions()
    }
  })

  return {
    permissions: _permissions,
    roles: _roles,
    loaded: _loaded,
    loading: _loading,
    loadPermissions,
    hasPermission,
    hasRole,
    filterMenus
  }
}
