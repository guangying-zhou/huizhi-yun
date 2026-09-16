<script setup lang="ts">
const { isNotificationsSlideoverOpen } = useDashboard()
const { summary, loadSummary } = useNotifications()

const REFRESH_INTERVAL_MS = 120_000

let refreshTimer: ReturnType<typeof setInterval> | null = null

const unreadLabel = computed(() => {
  const count = summary.value.unreadCount || 0
  if (count > 99) return '99+'
  return count ? String(count) : ''
})

function openNotifications() {
  isNotificationsSlideoverOpen.value = true
}

function stopRefreshTimer() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

function startRefreshTimer() {
  stopRefreshTimer()
  refreshTimer = setInterval(() => {
    if (!document.hidden) {
      void loadSummary()
    }
  }, REFRESH_INTERVAL_MS)
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopRefreshTimer()
    return
  }

  void loadSummary()
  startRefreshTimer()
}

onMounted(() => {
  if (!document.hidden) {
    void loadSummary()
    startRefreshTimer()
  }
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onBeforeUnmount(() => {
  stopRefreshTimer()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <div class="relative">
    <UButton
      icon="i-lucide-bell"
      color="neutral"
      variant="ghost"
      square
      size="sm"
      aria-label="通知"
      @click="openNotifications"
    />
    <span
      v-if="unreadLabel"
      class="pointer-events-none absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-semibold leading-4 text-white"
    >
      {{ unreadLabel }}
    </span>
  </div>
</template>
