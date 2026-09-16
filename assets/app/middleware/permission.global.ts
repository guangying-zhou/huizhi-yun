/**
 * 全局权限守卫中间件
 * 根据路由规则检查用户权限，无权限时重定向到无权限提示页
 */
import { matchRouteRule, resolveAssetsLandingRoute } from '~/config/permissions'

export default defineNuxtRouteMiddleware(async (to) => {
  // 跳过不需要权限检查的路由
  if (to.path === '/login' || to.path === '/no-access' || to.path.startsWith('/api/')) {
    return
  }

  const auth = useAuth()
  if (!auth.authenticated.value) {
    return auth.handleRouteAccess(to)
  }

  const rule = matchRouteRule(to.path)
  if (!rule) return // 无匹配规则，允许访问

  const { loadPermissions, hasPermission } = usePermissions()
  await loadPermissions()

  if (!hasPermission(rule.resource, rule.action)) {
    if (to.path === '/' || to.path === '/overview') {
      const landingRoute = resolveAssetsLandingRoute(hasPermission)
      if (landingRoute && landingRoute !== to.path) {
        return navigateTo(landingRoute)
      }
    }
    return navigateTo('/no-access')
  }
})
