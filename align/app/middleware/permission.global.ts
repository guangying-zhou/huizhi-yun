/**
 * 全局权限守卫中间件
 * 根据路由规则检查用户权限，无权限时重定向到首页
 */
import { matchRouteRule } from '~/config/permissions'

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/' || to.path === '/login' || to.path.startsWith('/api/')) {
    return
  }

  const rule = matchRouteRule(to.path)
  if (!rule) return

  const { user } = useAuth()
  const { loaded, loadPermissions, hasPermission } = usePermissions()
  const action = (
    rule.action
    || (rule as { requiredAction?: 'view' | 'edit' | 'admin' }).requiredAction
    || 'view'
  ) as 'view' | 'edit' | 'admin'

  if (user.value && !loaded.value) {
    await loadPermissions()
  }

  if (!hasPermission(rule.resource, action)) {
    console.warn(`[Permission] Access denied: ${to.path} requires ${rule.resource}:${action}`)
    return navigateTo('/', { replace: true })
  }
})
