const CONSOLE_MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const CONSOLE_ACTOR_BOUND_READ_PREFIXES = [
  '/api/notifications',
  '/api/v1/console/notifications',
  '/api/v1/console/authorization-lifecycle',
  '/api/v1/console/directory/me/password-capability',
  '/api/v1/console/directory/operations'
]

type ConsoleSessionActorSource = {
  uid: string
  user: {
    primaryDeptCode?: string | null
    deptCode?: string | null
  }
}

type ConsoleAuthContext = Record<string, unknown> & {
  authenticated?: boolean
}

/**
 * Convert a locally verified Console session into the user context consumed by
 * Foundation's Tenant Runtime client.  Browser BFF handlers call this again
 * after resolving their session so actor delegation does not depend solely on
 * middleware path classification.
 */
export function consoleSessionActorContext(
  session: ConsoleSessionActorSource,
  existing: ConsoleAuthContext | undefined
) {
  const deptCode = String(session.user.primaryDeptCode || session.user.deptCode || '').trim()
  return {
    ...(existing || {}),
    authenticated: true,
    subjectType: 'user',
    uid: session.uid,
    subjectCode: session.uid,
    tokenUse: 'console_session',
    ...(deptCode ? { deptCode, deptCodes: [deptCode] } : {})
  }
}

function apiPath(pathname: string) {
  const normalized = String(pathname || '').trim()
  const apiIndex = normalized.indexOf('/api/')
  return apiIndex >= 0 ? normalized.slice(apiIndex) : normalized
}

export function shouldResolveConsoleSessionActor(pathname: string, method: string) {
  const normalizedPath = apiPath(pathname)
  if (normalizedPath.startsWith('/api/workflow-proxy/')) return true
  if (
    normalizedPath === '/api/webdev-report'
    || normalizedPath.startsWith('/api/webdev-report/')
  ) {
    return true
  }
  if (
    String(method || '').toUpperCase() === 'GET'
    && CONSOLE_ACTOR_BOUND_READ_PREFIXES.some(prefix => (
      normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
    ))
  ) {
    return true
  }
  if (!normalizedPath.startsWith('/api/v1/console/')) return false
  return CONSOLE_MUTATION_METHODS.has(String(method || '').toUpperCase())
}
