/**
 * 全局权限守卫中间件
 * 根据路由规则检查用户权限，无权限时重定向到首页
 */
import { matchRouteRule } from '~/config/permissions'

export default defineNuxtRouteMiddleware(async (to) => {
  // 跳过不需要权限检查的路由
  if (to.path === '/' || to.path === '/login' || to.path.startsWith('/api/')) {
    return
  }

  const rule = matchRouteRule(to.path)
  if (!rule) return // 无匹配规则，允许访问

  const { hasPermission, loadPermissions, loaded } = usePermissions()
  if (!loaded.value) {
    await loadPermissions()
  }

  if (!hasPermission(rule.resource, rule.action)) {
    return navigateTo('/')
  }
})
