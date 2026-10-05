import { isPublicCodocsEditorShell } from '../utils/codocsEditorBoundary'

const publicRoutes = new Set([
  '/login',
  '/register',
  '/activate-email'
])

export default defineNuxtRouteMiddleware((to) => {
  // The embedded Codocs editor contains no document data until its separately
  // authorized API read succeeds. It must not start another OIDC flow in an
  // iframe after Enterprise has already authenticated the parent page.
  if (isPublicCodocsEditorShell(to.path, to.meta.publicEditorShell)) return
  const { createAuthRouteMiddleware } = useRouteAccess()
  const middleware = createAuthRouteMiddleware({
    isPublicRoute(route) {
      return route.path.startsWith('/api/') || publicRoutes.has(route.path)
    }
  })

  return middleware(to) as ReturnType<typeof navigateTo> | undefined
})
