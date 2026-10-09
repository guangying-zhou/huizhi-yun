<script setup lang="ts">
import type { Announcement } from '../../../console/shared/announcements'
import { announcementDismissalKey } from '../utils/announcement-dismissal'

const props = withDefaults(defineProps<{ titleVisible?: boolean }>(), { titleVisible: false })
const dismissed = ref<string[]>([])
function loadDismissed() {
  dismissed.value = []
  for (const item of data.value?.data.items || []) {
    const key = announcementDismissalKey(scope.value, item)
    try {
      if (key && localStorage.getItem(key) === '1') dismissed.value.push(key)
    } catch { /* Storage can be disabled; closing still works in this session. */ }
  }
}
function dismissBanner(item: Announcement) {
  const key = announcementDismissalKey(scope.value, item)
  if (!key) return
  dismissed.value = [...dismissed.value, key]
  try {
    localStorage.setItem(key, '1')
  } catch { /* Session-only fallback. */ }
}
const { data, failure, refresh, markRead, scope } = useAnnouncements()
const popup = computed(() => data.value?.data.items.find(a => a.popup && !a.read))
const banner = computed(() => data.value?.data.items.find(a => a.banner && !dismissed.value.includes(announcementDismissalKey(scope.value, a) || '')))
watch([scope, data], loadDismissed, { immediate: true })
const saving = ref(false)
const closeError = ref('')
async function closePopup() {
  if (!popup.value || saving.value) return
  saving.value = true
  closeError.value = ''
  try {
    await markRead(popup.value.id)
  } catch {
    closeError.value = '已读记录未保存，请重试关闭'
  } finally {
    saving.value = false
  }
}
onMounted(refresh)
watch(scope, refresh)
</script>

<template>
  <div
    aria-label="系统公告"
    class="contents"
  >
    <UTooltip
      v-if="failure && !props.titleVisible"
      :text="failure"
    >
      <UButton
        icon="i-lucide-megaphone"
        color="neutral"
        variant="ghost"
        aria-label="系统公告加载失败，点击重试"
        @click="refresh"
      />
    </UTooltip>
    <div
      v-else-if="banner && !props.titleVisible"
      class="flex min-w-0 max-w-full items-center gap-1 rounded-md text-sm"
      data-host-announcement-summary
      :class="banner.level === 'warning' ? 'text-warning' : 'text-toned'"
    >
      <NuxtLink
        :to="`/enterprise/announcements/${banner.id}`"
        class="flex min-w-0 items-center gap-2 rounded-md p-1 hover:bg-elevated"
        :title="banner.title"
        :aria-label="`系统公告：${banner.title}`"
      >
        <UIcon
          name="i-lucide-megaphone"
          class="shrink-0"
        />
        <span class="hidden min-w-0 truncate sm:block">{{ banner.title }}</span>
      </NuxtLink>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="xs"
        class="shrink-0"
        :aria-label="`关闭公告：${banner.title}`"
        @click="dismissBanner(banner)"
      />
    </div>
    <UModal
      :open="Boolean(popup)"
      :title="popup?.title || '系统公告'"
      :dismissible="false"
      :close="false"
    >
      <template #body>
        <SafeMarkdown
          v-if="popup"
          :content="popup.body"
        /><UAlert
          v-if="closeError"
          :title="closeError"
          color="error"
        />
      </template>
      <template #footer>
        <UButton
          :loading="saving"
          @click="closePopup"
        >
          我已阅读，关闭
        </UButton><UButton
          to="/enterprise/announcements"
          variant="ghost"
          @click="closePopup"
        >
          查看全部公告
        </UButton>
      </template>
    </UModal>
  </div>
</template>
