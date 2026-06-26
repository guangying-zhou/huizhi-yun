const publicRoutes = new Set(['/login'])

export default defineNuxtRouteMiddleware((to) => {
  const { createAuthRouteMiddleware } = useRouteAccess()
  const middleware = createAuthRouteMiddleware({
    isPublicRoute(route) {
      return route.path.startsWith('/api/') || publicRoutes.has(route.path)
    }
  })

  return middleware(to) as ReturnType<typeof navigateTo> | undefined
})
