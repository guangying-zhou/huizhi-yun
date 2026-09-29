type MiddlewareResult = ReturnType<Parameters<typeof defineNuxtRouteMiddleware>[0]>
export default defineNuxtRouteMiddleware((to): MiddlewareResult => {
  const { createAuthRouteMiddleware } = useRouteAccess()
  return createAuthRouteMiddleware({ isPublicRoute: route => ['/login', '/aims/login', '/assets/login', '/enterprise/login'].includes(route.path) || route.path.startsWith('/api/') })(to) as MiddlewareResult
})
