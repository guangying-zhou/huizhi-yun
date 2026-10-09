const publicRoutes = new Set([
  '/',
  '/login',
  '/admin/licenses',
  '/admin/login',
  '/dashboard/login',
  '/dashboard/register',
  '/register',
  '/activate-email',
  '/pricing',
  '/docs'
])

export default defineNuxtRouteMiddleware((to) => {
  const { createAuthRouteMiddleware } = useRouteAccess()
  const middleware = createAuthRouteMiddleware({
    isPublicRoute(route) {
      return route.path.startsWith('/api/') || publicRoutes.has(route.path)
    }
  })

  return middleware(to)
})
