import { matchRouteRule } from '~/config/permissions'

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login' || to.path === '/no-access' || to.path.startsWith('/api/')) {
    return
  }

  const { authenticated } = useAuth()
  if (!authenticated.value) {
    return
  }

  const rule = matchRouteRule(to.path)
  if (!rule) return

  const { ensurePeoplePermission } = usePeopleAuthorization()
  const result = await ensurePeoplePermission(rule.resource, rule.action)

  if (!result.authorized) {
    return navigateTo('/no-access')
  }
})
