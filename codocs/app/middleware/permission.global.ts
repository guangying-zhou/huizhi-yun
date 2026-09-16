/**
 * 全局路由权限守卫
 *
 * 在 auth.global.ts 之后执行（按文件名字母序）
 * 检查当前路由是否需要特定资源权限
 */
import { matchRouteRule } from '~/config/permissions'

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login' || to.path === '/' || to.path.startsWith('/api/')) {
    return
  }

  const rule = matchRouteRule(to.path)
  if (!rule) return

  const auth = useAuth()
  const { loaded, loadPermissions, hasPermission, clearCache } = usePermissions()
  const action = rule.requiredAction || 'view'

  if (!auth.authenticated.value) {
    return
  }

  if (auth.authenticated.value && !loaded.value) {
    await loadPermissions()
  }

  if (!hasPermission(rule.resource, action)) {
    clearCache()
    await loadPermissions()
  }

  if (!hasPermission(rule.resource, action)) {
    console.warn(`[Permission] Access denied: ${to.path} requires ${rule.resource}:${action}`)
    return navigateTo('/', { replace: true })
  }
})
