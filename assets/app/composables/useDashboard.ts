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

  function toggleSidebarCollapsed() {
    isSidebarCollapsed.value = !isSidebarCollapsed.value
    userPinnedCollapsed.value = true
    if (import.meta.client) {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(isSidebarCollapsed.value))
    }
  }

  return {
    isNotificationsSlideoverOpen,
    isSidebarCollapsed,
    hasStoredSidebarCollapsed,
    userPinnedCollapsed,
    toggleSidebarCollapsed
  }
}

export const useDashboard = createSharedComposable(_useDashboard)
