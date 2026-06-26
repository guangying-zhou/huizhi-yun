type NuxtRouteMiddlewareReturn = ReturnType<Parameters<typeof defineNuxtRouteMiddleware>[0]>

export default defineNuxtRouteMiddleware((to): NuxtRouteMiddlewareReturn => {
  const { createAuthRouteMiddleware } = useRouteAccess()
  const middleware = createAuthRouteMiddleware({
    isPublicRoute(route) {
      return route.path.startsWith('/api/') || route.path === '/login'
    }
  })

  return middleware(to) as NuxtRouteMiddlewareReturn
})
