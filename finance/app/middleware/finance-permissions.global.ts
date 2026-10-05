import { matchRouteRule } from '~/config/permissions'

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path.startsWith('/api/') || to.path === '/login' || to.path === '/no-access') return

  const { authenticated } = useAuth()
  if (!authenticated.value) {
    return
  }

  const rule = matchRouteRule(to.path)
  if (!rule) return

  const { loadPermissions, hasPermission, loaded } = usePermissions()
  if (!loaded.value) {
    await loadPermissions()
  }

  if (!hasPermission(rule.resource, rule.action)) {
    return navigateTo('/no-access')
  }
})
