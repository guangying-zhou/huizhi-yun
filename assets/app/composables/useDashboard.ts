import { createSharedComposable } from '@vueuse/core'

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'hzy:sidebar-collapsed'

const _useDashboard = () => {
  const route = useRoute()
  const router = useRouter()
  const isNotificationsSlideoverOpen = ref(false)
  const storedSidebarCollapsed = import.meta.client
    ? window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)
    : null
  const userPinnedCollapsed = ref(storedSidebarCollapsed !== null)
  const hasStoredSidebarCollapsed = userPinnedCollapsed
  const isSidebarCollapsed = ref(storedSidebarCollapsed === 'true')

  defineShortcuts({
    'g-h': () => router.push('/'),
    'g-s': () => router.push('/settings/profile'),
    'n': () => isNotificationsSlideoverOpen.value = !isNotificationsSlideoverOpen.value
  })

  watch(() => route.fullPath, () => {
    isNotificationsSlideoverOpen.value = false
  })

  /** 与 Foundation 保持相同的折叠状态接口，供共享 LayoutSidebar 调用。 */
  function setSidebarCollapsed(collapsed: boolean, persistPreference = false) {
    isSidebarCollapsed.value = collapsed
    if (!persistPreference) return

    userPinnedCollapsed.value = true
    if (import.meta.client) {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(isSidebarCollapsed.value))
    }
  }

  function toggleSidebarCollapsed() {
    setSidebarCollapsed(!isSidebarCollapsed.value, true)
  }

  return {
    isNotificationsSlideoverOpen,
    isSidebarCollapsed,
    hasStoredSidebarCollapsed,
    userPinnedCollapsed,
    setSidebarCollapsed,
    toggleSidebarCollapsed
  }
}

export const useDashboard = createSharedComposable(_useDashboard)
