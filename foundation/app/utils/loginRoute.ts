import type { RouteLocationNormalized } from 'vue-router'

// Apps may mount the login page under extra paths (route aliases or a prefixed
// base). Foundation must recognize every one of them as the login route, or it
// treats the login page as protected and re-triggers the login flow on it.
const DEFAULT_LOGIN_PATHS = ['/login']

export type PublicRuntimeLike = Record<string, unknown> | undefined

function isAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
}

export function loginRoutePaths(publicConfig: PublicRuntimeLike): string[] {
  const configured = (publicConfig || {}).loginPaths
  if (Array.isArray(configured)) {
    const paths = configured.filter(isAbsolutePath)
    if (paths.length) return [...new Set(paths)]
  }
  const single = (publicConfig || {}).enterpriseLoginPath
  return [...new Set([...DEFAULT_LOGIN_PATHS, ...(isAbsolutePath(single) ? [single] : [])])]
}

export function isLoginRoutePath(publicConfig: PublicRuntimeLike, path: string): boolean {
  return loginRoutePaths(publicConfig).includes(path)
}

export function isLoggedOutLoginRoute(publicConfig: PublicRuntimeLike, to: RouteLocationNormalized): boolean {
  return isLoginRoutePath(publicConfig, to.path)
    && (to.query.logged_out === '1' || to.query.state === 'logged_out')
}

export function loginRedirectTarget(
  publicConfig: PublicRuntimeLike,
  to: Pick<RouteLocationNormalized, 'fullPath'>,
  resolveCurrentAppUrl: (path: string) => string
): string {
  const fullPath = typeof to.fullPath === 'string' && to.fullPath.startsWith('/') && !to.fullPath.startsWith('//')
    ? to.fullPath
    : '/'
  // Enterprise is mounted at the origin root and owns several sibling module
  // prefixes. Resolving /enterprise against appHomeUrl=/enterprise/ would
  // incorrectly produce /enterprise/enterprise after OIDC login.
  if (publicConfig?.appCode === 'enterprise' && publicConfig.authApiPrefix === '/enterprise') return fullPath
  return resolveCurrentAppUrl(fullPath)
}
