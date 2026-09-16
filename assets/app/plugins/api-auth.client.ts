type FetchErrorLike = {
  status?: number
  statusCode?: number
  response?: {
    status?: number
    statusCode?: number
  }
}

type AuthWithOptionalRecovery = ReturnType<typeof useAuth> & {
  refresh?: () => Promise<unknown>
  login?: (redirect?: string) => Promise<unknown> | unknown
}

function requestPath(request: unknown) {
  const raw = typeof request === 'string'
    ? request
    : request instanceof URL
      ? request.toString()
      : request instanceof Request
        ? request.url
        : ''

  if (!raw) return ''
  if (raw.startsWith('/')) return raw

  try {
    const url = new URL(raw, window.location.origin)
    if (url.origin !== window.location.origin) return ''
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return ''
  }
}

function normalizeBasePath(value: unknown) {
  const normalized = String(value || '/').trim()
  if (!normalized || normalized === '/') return ''
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

function isAppApiPath(path: string, appBasePath: string) {
  return path.startsWith('/api/')
    || Boolean(appBasePath && path.startsWith(`${appBasePath}/api/`))
}

function isAuthControlPath(path: string) {
  return path.includes('/api/auth/')
}

function statusCode(error: unknown) {
  const value = error as FetchErrorLike | null | undefined
  return Number(
    value?.statusCode
    || value?.status
    || value?.response?.statusCode
    || value?.response?.status
    || 0
  )
}

function withAuthOptions(options: Record<string, unknown> | undefined, token: string) {
  const headers = new Headers(options?.headers as HeadersInit | undefined)
  if (token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`)
  }

  return {
    ...(options || {}),
    credentials: 'include',
    headers
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  const originalFetch = nuxtApp.$fetch || globalThis.$fetch
  const originalFetchCall = originalFetch as unknown as (request: unknown, options?: Record<string, unknown>) => Promise<unknown>
  const auth = useAuth() as AuthWithOptionalRecovery
  const config = useRuntimeConfig()
  const appBasePath = normalizeBasePath(config.public?.appBasePath)
  let refreshPromise: Promise<boolean> | null = null
  let redirecting = false

  async function refreshOnce() {
    const refresh = auth.refresh
    if (typeof refresh !== 'function') return false
    if (refreshPromise) return await refreshPromise

    refreshPromise = (async () => {
      try {
        await refresh()
        return Boolean(auth.authenticated.value && auth.token.value)
      } catch {
        return false
      } finally {
        refreshPromise = null
      }
    })()

    return await refreshPromise
  }

  async function loginOnce() {
    if (redirecting) return
    const login = auth.login
    if (typeof login !== 'function') return
    redirecting = true
    await login(window.location.href)
  }

  async function assetsFetch(request: unknown, options?: Record<string, unknown>) {
    const path = requestPath(request)
    if (!isAppApiPath(path, appBasePath)) {
      return await originalFetchCall(request, options)
    }

    const nextOptions = withAuthOptions(options, String(auth.token.value || ''))
    try {
      return await originalFetchCall(request, nextOptions)
    } catch (error) {
      if (statusCode(error) !== 401 || isAuthControlPath(path)) {
        throw error
      }

      if (await refreshOnce()) {
        return await originalFetchCall(request, withAuthOptions(options, String(auth.token.value || '')))
      }

      await loginOnce()
      throw error
    }
  }

  Object.assign(assetsFetch, originalFetch)
  nuxtApp.$fetch = assetsFetch as typeof nuxtApp.$fetch
  globalThis.$fetch = assetsFetch as typeof globalThis.$fetch
})
