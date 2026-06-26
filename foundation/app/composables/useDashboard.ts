import { createSharedComposable } from '@vueuse/core'

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'hzy:sidebar-collapsed'

const _useDashboard = () => {
  const route = useRoute()
  const router = useRouter()
  const isNotificationsSlideoverOpen = ref(false)
  const storedSidebarCollapsed = import.meta.client
    ? window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)
    : null
  // 仅当 localStorage 中有用户显式设置的值时才为 true
  const userPinnedCollapsed = ref(storedSidebarCollapsed !== null)
  const isSidebarCollapsed = ref(storedSidebarCollapsed === 'true')

  defineShortcuts({
    'g-h': () => router.push('/'),
    'g-s': () => router.push('/settings/profile'),
    'n': () => isNotificationsSlideoverOpen.value = !isNotificationsSlideoverOpen.value
  })

  watch(() => route.fullPath, () => {
    isNotificationsSlideoverOpen.value = false
  })

  /**
   * 用户显式切换侧边栏折叠状态时调用
   * 只有这个方法会持久化到 localStorage
   */
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
    userPinnedCollapsed,
    toggleSidebarCollapsed
  }
}

export const useDashboard = createSharedComposable(_useDashboard)
