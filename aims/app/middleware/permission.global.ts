/**
 * 全局权限守卫中间件
 * 根据路由规则检查用户权限，无权限时重定向到首页
 */
import { matchRouteRule, routeRuleRequirements } from '~/config/permissions'

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/' || to.path === '/login' || to.path.startsWith('/api/')) {
    return
  }

  const rule = matchRouteRule(to.path)
  if (!rule) return

  const { user } = useAuth()
  const { loaded, loadPermissions, hasPermission, hasRole, clearCache } = usePermissions()

  if (user.value && !loaded.value) {
    await loadPermissions()
  }

  const requirements = routeRuleRequirements(rule)
  const allowed = () => hasRole('system_admin')
    || hasRole('platform:admin')
    || hasRole('super_admin')
    || hasRole('aims:admin')
    || (to.path.startsWith('/admin/products') && (
      hasRole('assets:admin')
      || hasRole('assets:product-admin')
      || hasRole('assets:product-manager')
    ))
    || hasRole('console:admin')
    || hasRole('console:console-dev-admin')
    || requirements.some(item => hasPermission(item.resource, item.action))

  if (!allowed()) {
    clearCache()
    await loadPermissions()
  }

  if (!allowed()) {
    const requirementText = requirements.map(item => `${item.resource}:${item.action}`).join(' or ')
    console.warn(`[Permission] Access denied: ${to.path} requires ${requirementText}`)
    return navigateTo('/', { replace: true })
  }
})
