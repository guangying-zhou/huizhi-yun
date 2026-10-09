import { createSharedComposable } from '@vueuse/core'

const _useRepoInsightDashboard = () => {
  const route = useRoute()
  const router = useRouter()
  const isNotificationsSlideoverOpen = ref(false)
  const isSidebarCollapsed = ref(false)

  // Get business from route params
  const business = computed(() => route.params.business as string)
  const baseUrl = computed(() => `/${business.value}`)

  defineShortcuts({
    'g-h': () => router.push(baseUrl.value),
    'g-d': () => router.push(`${baseUrl.value}/dashboard`),
    'g-r': () => router.push(`${baseUrl.value}/repos`),
    'g-s': () => router.push(`${baseUrl.value}/settings`),
    'n': () => isNotificationsSlideoverOpen.value = !isNotificationsSlideoverOpen.value
  })

  watch(() => route.fullPath, () => {
    isNotificationsSlideoverOpen.value = false
  })

  return {
    isNotificationsSlideoverOpen,
    isSidebarCollapsed,
    business,
    baseUrl
  }
}

export const useRepoInsightDashboard = createSharedComposable(_useRepoInsightDashboard)
