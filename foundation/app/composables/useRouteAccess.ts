import {
  createAuthGuard,
  createCapabilityGuard,
  createPermissionGuard,
  type ClientRouteLike,
  type RouteCapabilityRule,
  type RoutePermissionRule
} from '@hzy/platform-adapter-nuxt'
import type { RouteLocationNormalized } from 'vue-router'

type RouteLike = RouteLocationNormalized | ClientRouteLike

function toClientRoute(route: RouteLike): ClientRouteLike {
  return {
    path: route.path,
    fullPath: 'fullPath' in route && route.fullPath ? route.fullPath : route.path
  }
}

export function useRouteAccess() {
  const auth = useAuth()
  const permission = usePlatformPermission()

  function createAuthRouteMiddleware(options: {
    isPublicRoute?: (route: RouteLocationNormalized) => boolean
  } = {}) {
    const guard = createAuthGuard({
      isAuthenticated: () => auth.authenticated.value,
      isPublicRoute: route => options.isPublicRoute?.(route as RouteLocationNormalized) || false,
      onUnauthenticated: route => auth.handleRouteAccess(route as RouteLocationNormalized)
    })

    return async (route: RouteLocationNormalized) => {
      if (options.isPublicRoute?.(route)) {
        return
      }

      const guardResult = guard(toClientRoute(route))
      if (guardResult) {
        return guardResult
      }

      return await auth.handleRouteAccess(route)
    }
  }

  function createPermissionRouteMiddleware(options: {
    resolveRule: (route: RouteLocationNormalized) => RoutePermissionRule | null
    onUnauthorized?: (route: RouteLocationNormalized, rule: RoutePermissionRule) => unknown
  }) {
    const guard = createPermissionGuard({
      resolveRule: route => options.resolveRule(route as RouteLocationNormalized),
      hasPermission: (resourceCode, action, _appCode) => permission.hasPermission(resourceCode, action || 'view'),
      onUnauthorized: (route, rule) => options.onUnauthorized?.(route as RouteLocationNormalized, rule) ?? navigateTo('/')
    })

    return (route: RouteLocationNormalized) => guard(toClientRoute(route))
  }

  function createCapabilityRouteMiddleware(options: {
    resolveRule: (route: RouteLocationNormalized) => RouteCapabilityRule | null
    onUnauthorized?: (route: RouteLocationNormalized, rule: RouteCapabilityRule) => unknown
  }) {
    const guard = createCapabilityGuard({
      resolveRule: route => options.resolveRule(route as RouteLocationNormalized),
      hasCapability: permission.hasCapability,
      onUnauthorized: (route, rule) => options.onUnauthorized?.(route as RouteLocationNormalized, rule) ?? navigateTo('/')
    })

    return (route: RouteLocationNormalized) => guard(toClientRoute(route))
  }

  return {
    createAuthRouteMiddleware,
    createPermissionRouteMiddleware,
    createCapabilityRouteMiddleware
  }
}
