import { createSessionCacheCoordinator, isEnterpriseSessionCacheKey } from '../../shared/session-cache.mjs'

export default defineNuxtPlugin(() => {
  const scope = useState<string>('enterprise-cache-scope', () => '')
  const auth = useAuth()
  const config = useRuntimeConfig()
  const coordinator = createSessionCacheCoordinator({
    fetchSession: () => $fetch(`${config.public.authApiPrefix || ''}/api/auth/me`, { cache: 'no-store' }),
    onChange(next) {
      clearNuxtData(isEnterpriseSessionCacheKey)
      clearNuxtState(isEnterpriseSessionCacheKey)
      scope.value = next
    }
  })
  // Cookies/claims only invalidate; they never supply the identity used in keys.
  watch(() => [auth.token.value, auth.tenant?.value, auth.policyVersion?.value], () => {
    coordinator.invalidate()
    void coordinator.refresh().catch(() => {})
  })
  const onFocus = () => { void coordinator.refresh().catch(() => {}) }
  window.addEventListener('focus', onFocus)
  onScopeDispose(() => window.removeEventListener('focus', onFocus))
  return { provide: { enterpriseSession: {
    refresh: coordinator.refresh,
    async logout() { coordinator.invalidate(); return auth.logout() }
  } } }
})
