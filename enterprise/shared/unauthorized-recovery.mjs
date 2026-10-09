// Host-wide 401 recovery for same-origin business API calls.
//
// A page left open can outlive its short-lived access token (sleep, throttled
// background timers, another tab rotating the token). The Host then answers
// business APIs with 401 while /enterprise/api/auth/me still reports a
// refreshable session. This wrapper lets the existing Host session
// coordinator renew once — shared by every request that fails concurrently —
// and replays the failed request once. It never becomes a second session store.

// Host business prefixes. Console (/console, root /api) has its own session.
const BUSINESS_API = /^\/(?:enterprise|aims|assets|codocs|altoc)\/api\//
// The auth endpoints themselves must never trigger recovery (no loops).
const AUTH_API = /^\/enterprise\/api\/auth(?:\/|$)/

export function unauthorizedStatus(error) {
  const record = error || {}
  return Number(record.statusCode || record.status || record.response?.status || 0)
}

/** Same-origin Host business API request given as a string or URL. */
export function isRecoverableRequest(request, origin) {
  if (typeof request !== 'string' && !(request instanceof URL)) return false
  let url
  try {
    url = new URL(String(request), origin)
  } catch {
    return false
  }
  return url.origin === origin && BUSINESS_API.test(url.pathname) && !AUTH_API.test(url.pathname)
}

/**
 * A 401 is rejected before the handler runs, but a write is only replayed when
 * the caller made it idempotent; streams cannot be resent.
 */
export function canReplay(options) {
  const body = options?.body
  if (body && typeof body === 'object' && typeof body.getReader === 'function') return false
  const method = String(options?.method || 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return true
  try {
    return Boolean(new Headers(options?.headers || undefined).get('idempotency-key'))
  } catch {
    return false
  }
}

/** One recovery at a time; concurrent 401s await the same attempt. */
export function coalesce(task) {
  let pending = null
  return () => {
    pending ||= Promise.resolve().then(task).finally(() => {
      pending = null
    })
    return pending
  }
}

/**
 * Wraps an ofetch-style `$fetch` (callable plus `.raw`). `recover()` resolves
 * true when the session was renewed and verified; false or a rejection keeps
 * the original 401 for the caller.
 */
export function withUnauthorizedRecovery(baseFetch, { origin, recover, getScope }) {
  const recoverOnce = coalesce(recover)
  const wrap = call => async (request, options) => {
    // Bind the intent before dispatch. A refresh can discover that another tab
    // switched user, tenant, deployment or authorization context.
    const requestScope = getScope()
    try {
      return await call(request, options)
    } catch (error) {
      if (unauthorizedStatus(error) !== 401 || !isRecoverableRequest(request, origin())) throw error
      let recovered = false
      try {
        recovered = await recoverOnce()
      } catch {
        recovered = false
      }
      if (recovered !== true || !requestScope || getScope() !== requestScope || !canReplay(options)) throw error
      return await call(request, options)
    }
  }
  const wrapped = wrap((request, options) => baseFetch(request, options))
  if (typeof baseFetch.raw === 'function') wrapped.raw = wrap((request, options) => baseFetch.raw(request, options))
  for (const key of ['native', 'create']) {
    if (key in baseFetch) wrapped[key] = baseFetch[key]
  }
  return wrapped
}
