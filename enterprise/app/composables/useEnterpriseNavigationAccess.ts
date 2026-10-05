import { enterpriseNavigation } from '../utils/enterprise-navigation'
import { createNavigationAccessLoader, filterNavigationAccess, filterWorkspaceAccess } from '../../shared/navigation-access.mjs'
import { inject, provide, type InjectionKey } from 'vue'

const navigationAccessKey: InjectionKey<ReturnType<typeof createEnterpriseNavigationAccess>> = Symbol('enterprise-navigation-access')

export function useEnterpriseNavigationAccess() {
  // The Host layout owns the lease and refresh lifecycle. Its pages consume
  // that same snapshot, rather than issuing competing authorization requests.
  const inherited = inject(navigationAccessKey, null)
  if (inherited) return inherited
  const access = createEnterpriseNavigationAccess()
  provide(navigationAccessKey, access)
  return access
}

function createEnterpriseNavigationAccess() {
  const scope = useState<string>('enterprise-cache-scope', () => '')
  const route = useRoute()
  const visibleIds = ref<string[]>([])
  const status = ref('idle')
  const nuxtApp = useNuxtApp()
  // A navigation 401 prompts one session check; the session plugin sends the
  // user to login only if that check confirms the session is gone.
  const recheckSession = () => {
    if (!import.meta.client) return
    const session = nuxtApp.$enterpriseSession as { refresh: () => Promise<string> } | undefined
    void session?.refresh().catch(() => {})
  }
  // A policy version change keeps the session valid: renew the token once and
  // reload navigation. A repeat within the window shows the unavailable state
  // instead of looping.
  let lastPolicyRenewal = 0
  const renewForPolicy = () => {
    if (!import.meta.client || Date.now() - lastPolicyRenewal < 60_000) return false
    const session = nuxtApp.$enterpriseSession as { renewToken?: () => Promise<void> } | undefined
    if (!session?.renewToken) return false
    lastPolicyRenewal = Date.now()
    void session.renewToken().then(() => refresh(), () => recheckSession())
    return true
  }
  const loader = createNavigationAccessLoader({
    fetchAccess: async (signal: AbortSignal) => {
      try {
        return await $fetch<{ visibleIds: string[], maxAgeMs: number }>('/enterprise/api/navigation', { signal, cache: 'no-store', retry: 0 })
      } catch (error) {
        const failure = error as { statusCode?: number, data?: { code?: string, data?: { code?: string } } }
        if (failure?.statusCode === 401) {
          const code = failure.data?.data?.code ?? failure.data?.code
          if (code !== 'enterprise_policy_version_changed' || !renewForPolicy()) recheckSession()
        }
        throw error
      }
    },
    publish(ids: string[], next: string) {
      visibleIds.value = ids
      status.value = next
    }
  })
  const refresh = () => loader.refresh(scope.value)
  watch(scope, refresh, { immediate: true, flush: 'sync' })
  watch(() => route.path, refresh)
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    window.addEventListener('focus', refresh)
    // Well inside the 5-minute lease; route changes and focus refresh at once.
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 120_000)
  })
  onScopeDispose(() => {
    loader.clear()
    if (timer) clearInterval(timer)
    if (import.meta.client) window.removeEventListener('focus', refresh)
  })
  return {
    navigation: computed(() => filterNavigationAccess(enterpriseNavigation.businessNavigation, visibleIds.value)),
    workspaces: computed(() => filterWorkspaceAccess(enterpriseNavigation.objectWorkspaces, visibleIds.value)),
    status, refresh
  }
}
