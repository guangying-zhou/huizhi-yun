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
  const { loaded, loadPermissions, hasPermission, clearCache } = usePermissions()
  const isAimsAdminRoute = to.path === '/admin'
    || to.path.startsWith('/admin/')
    || to.path === '/aims/admin'
    || to.path.startsWith('/aims/admin/')

  if (user.value && (isAimsAdminRoute || !loaded.value)) {
    await loadPermissions({ force: isAimsAdminRoute })
  }

  const requirements = routeRuleRequirements(rule)
  const allowed = () => requirements.some(item => hasPermission(item.resource, item.action))

  if (!allowed()) {
    clearCache()
    await loadPermissions({ force: true })
  }

  if (!allowed()) {
    const requirementText = requirements.map(item => `${item.resource}:${item.action}`).join(' or ')
    console.warn(`[Permission] Access denied: ${to.path} requires ${requirementText}`)
    return navigateTo('/', { replace: true })
  }
})
