export function validatedSessionScope(session) {
  if (!session || session.authenticated !== true || session.provider !== 'console_oidc') return ''
  const fields = [session.tenant, session.uid || session.subjectCode, session.policyVersion]
  if (fields.some(value => typeof value !== 'string' || !value.trim())) return ''
  return JSON.stringify([session.tenant, session.uid || '', session.subjectCode || '', session.policyVersion, session.deployment || ''])
}

export function isEnterpriseSessionCacheKey(key) {
  return typeof key === 'string' && key.startsWith('hzy:enterprise:')
}

// Wraps the session fetch. A successful response that says unauthenticated
// and not refreshable, after an authenticated one, is a confirmed sign-out
// (e.g. the Console session reached its absolute lifetime while the page
// stayed open). An expired access token that can still be refreshed is not a
// sign-out, and failed requests never count: an unavailable check must not
// send the user to login.
export function watchSessionLoss(fetchSession, onLost) {
  let authenticated = false
  return async () => {
    const session = await fetchSession()
    if (session?.authenticated === true) authenticated = true
    else if (session?.refreshable !== true) {
      if (authenticated) onLost()
      authenticated = false
    }
    return session
  }
}

export function createSessionCacheCoordinator({ fetchSession, onChange, onVerified }) {
  let scope = ''
  let verifiedScope = ''
  let generation = 0
  let pending = null
  function change(next) {
    if (scope === next) return
    const previous = scope
    scope = next
    onChange(next, previous)
  }
  // Invalidate drops the key scope synchronously for cache isolation, but page
  // identity must only move when a verification actually lands, or every token
  // rotation remounts each keyed page twice.
  function verified(next) {
    change(next)
    if (verifiedScope === next) return
    verifiedScope = next
    onVerified?.(next)
  }
  function invalidate() { generation++; pending = null; change('') }
  function refresh() {
    if (pending) return pending
    const requestGeneration = generation
    const request = Promise.resolve().then(fetchSession).then(session => {
      // A token refresh can invalidate an in-flight route check. Follow the
      // replacement verification instead of treating cancellation as logout.
      // With no replacement, only the current verified scope is usable.
      if (requestGeneration !== generation) return pending || scope
      const next = validatedSessionScope(session)
      verified(next)
      return next
    }).catch(error => {
      if (requestGeneration === generation) verified('')
      throw error
    }).finally(() => { if (pending === request) pending = null })
    pending = request
    return request
  }
  return { refresh, invalidate, getScope: () => scope }
}
export function safeLoginRedirect(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\\\u0000-\u0020]/.test(value)) return '/'
  try {
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith('//') || /[\\\u0000-\u0020]/.test(decoded)) return '/'
    const target = new URL(value, 'https://enterprise.invalid')
    if (target.origin !== 'https://enterprise.invalid' || ['/login', '/aims/login', '/assets/login', '/enterprise/login'].includes(target.pathname)) return '/'
    return target.pathname + target.search + target.hash
  } catch { return '/' }
}
