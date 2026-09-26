import { createSessionCacheCoordinator, isEnterpriseSessionCacheKey, watchSessionLoss } from '../../shared/session-cache.mjs'

const LOGIN_PATHS = ['/login', '/aims/login', '/assets/login', '/enterprise/login']

export default defineNuxtPlugin((nuxtApp) => {
  const scope = useState<string>('enterprise-cache-scope', () => '')
  const verifiedScope = useState<string>('enterprise-verified-scope', () => '')
  const auth = useAuth()
  const config = useRuntimeConfig()
  const router = useRouter()
  // The route middleware only checks on navigation. A page left open past the
  // session lifetime learns of it here (focus, token change, navigation 401).
  let leaving = false
  const leaveForLogin = () => {
    const current = router.currentRoute.value
    if (leaving || LOGIN_PATHS.includes(current.path)) return
    leaving = true
    void Promise.resolve(nuxtApp.runWithContext(() => navigateTo({ path: String(config.public.enterpriseLoginPath || '/login'), query: { redirect: current.fullPath } })))
      .finally(() => {
        leaving = false
      })
  }
  const coordinator = createSessionCacheCoordinator({
    fetchSession: watchSessionLoss(async () => {
      const meUrl: string = `${config.public.authApiPrefix || ''}/api/auth/me`
      const fetchMe = () => ($fetch as (url: string, options: { cache: 'no-store' }) => Promise<{ authenticated?: boolean, refreshable?: boolean }>)(meUrl, { cache: 'no-store' })
      const session = await fetchMe()
      // An expired access token with a live refresh token: renew, then re-check.
      const refresh = (auth as { refresh?: () => Promise<void> }).refresh
      if (session?.authenticated !== true && session?.refreshable === true && refresh) {
        try {
          await refresh()
          return await fetchMe()
        } catch {
          return session
        }
      }
      return session
    }, leaveForLogin),
    onChange(next) {
      clearNuxtData(isEnterpriseSessionCacheKey)
      clearNuxtState(isEnterpriseSessionCacheKey)
      scope.value = next
    },
    onVerified(next) { verifiedScope.value = next }
  })
  // Cookies/claims only invalidate; they never supply the identity used in keys.
  watch(() => [auth.token.value, auth.user?.value, auth.tenant?.value, auth.subjectCode?.value, auth.policyVersion?.value], () => {
    coordinator.invalidate()
    void coordinator.refresh().catch(() => {})
  }, { flush: 'sync' })
  const onFocus = () => {
    void coordinator.refresh().catch(() => {})
  }
  window.addEventListener('focus', onFocus)
  onScopeDispose(() => window.removeEventListener('focus', onFocus))
  // Renews the access token of a still-valid session (e.g. after a policy
  // version change). The token watcher above then re-derives the cache scope.
  let renewing: Promise<void> | undefined
  const renewToken = () => {
    const refresh = (auth as { refresh?: () => Promise<void> }).refresh
    if (!refresh) return Promise.reject(new Error('Token renewal unavailable'))
    renewing ||= refresh().finally(() => {
      renewing = undefined
    })
    return renewing
  }
  return { provide: { enterpriseSession: {
    refresh: coordinator.refresh,
    renewToken,
    async logout() {
      coordinator.invalidate()
      return auth.logout()
    }
  } } }
})
