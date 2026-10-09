/**
 * 全局路由权限守卫
 *
 * 在 auth.global.ts 之后执行（按文件名字母序）
 * 检查当前路由是否需要特定资源权限
 */
import { matchRouteRule } from '~/config/permissions'

export default defineNuxtRouteMiddleware((to) => {
  if (to.path === '/login' || to.path.startsWith('/api/')) {
    return
  }

  // 首页无需权限检查
  if (to.path === '/') {
    return
  }

  // 仅在客户端检查
  if (import.meta.server) {
    return
  }

  const { hasPermission, loaded } = usePermissions()

  if (!loaded.value) {
    return
  }

  const rule = matchRouteRule(to.path)
  if (!rule) {
    return
  }

  const action = rule.requiredAction || 'view'
  if (!hasPermission(rule.resource, action)) {
    console.warn(`[Permission] Access denied: ${to.path} requires ${rule.resource}:${action}`)
    return navigateTo('/', { replace: true })
  }
})
