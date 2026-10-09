import type { RouteLocationNormalized } from 'vue-router'

function isPublicRoute(path: string) {
  return path === '/'
    || path === '/login'
    || path === '/admin/login'
    || path === '/dashboard/login'
    || path === '/dashboard/register'
    || path === '/register'
    || path === '/activate-email'
    || path === '/pricing'
    || path === '/docs'
    || path.startsWith('/api/')
}

function scopeFromPath(path: string): 'admin' | 'dashboard' {
  return path.startsWith('/admin') ? 'admin' : 'dashboard'
}

function loginPathForScope(scope: 'admin' | 'dashboard') {
  return scope === 'admin' ? '/admin/login' : '/dashboard/login'
}

export function useRouteAccess() {
  const auth = useAuth()

  function createAuthRouteMiddleware(options: {
    isPublicRoute?: (route: RouteLocationNormalized) => boolean
  } = {}) {
    return async (route: RouteLocationNormalized) => {
      if (options.isPublicRoute?.(route) || isPublicRoute(route.path)) {
        return
      }

      const scope = scopeFromPath(route.path)
      await auth.loadMe({ scope })

      if (auth.authenticated.value) {
        return
      }

      return navigateTo({
        path: loginPathForScope(scope),
        query: {
          redirect: route.fullPath
        }
      })
    }
  }

  return {
    createAuthRouteMiddleware
  }
}
