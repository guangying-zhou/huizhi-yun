export function validatedSessionScope(session) {
  if (!session || session.authenticated !== true || session.provider !== 'console_oidc') return ''
  const fields = [session.tenant, session.uid || session.subjectCode, session.policyVersion]
  if (fields.some(value => typeof value !== 'string' || !value.trim())) return ''
  return JSON.stringify([session.tenant, session.uid || '', session.subjectCode || '', session.policyVersion, session.deployment || ''])
}

export function isEnterpriseSessionCacheKey(key) {
  return typeof key === 'string' && key.startsWith('hzy:enterprise:')
}

export function createSessionCacheCoordinator({ fetchSession, onChange }) {
  let scope = ''
  let generation = 0
  let pending = null
  function change(next) {
    if (scope === next) return
    const previous = scope
    scope = next
    onChange(next, previous)
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
      change(next)
      return next
    }).catch(error => {
      if (requestGeneration === generation) change('')
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
