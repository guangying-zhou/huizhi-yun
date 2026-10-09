<script setup lang="ts">
import type { AnnouncementPage } from '../../../../../console/shared/announcements'

definePageMeta({ name: 'console-host-announcement-detail', navigationOwner: 'console' })
const route = useRoute()
const { data, error, refresh } = await useFetch<AnnouncementPage>(() => `/enterprise/api/announcements/${encodeURIComponent(String(route.params.announcementId))}`, { server: false })
const item = computed(() => data.value?.data.items[0])
const { markRead } = useAnnouncements()
const readError = ref('')
async function read() {
  if (!item.value) return
  try {
    await markRead(item.value.id)
    item.value.read = true
  } catch {
    readError.value = '已读记录未保存，请重试'
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6">
    <UButton
      to="/enterprise/announcements"
      variant="ghost"
      icon="i-lucide-arrow-left"
    >
      系统公告
    </UButton>
    <UAlert
      v-if="error"
      color="error"
      :title="error.statusCode === 403 ? '公告已失效或当前无权查看' : '公告暂不可用'"
      :actions="[{ label: '重试', onClick: () => refresh() }]"
    />
    <template v-else-if="item">
      <ContentPageHeader
        hosted
        :title="item.title"
      /><SafeMarkdown :content="item.body" /><UAlert
        v-if="readError"
        :title="readError"
        color="error"
      /><UButton
        :disabled="item.read"
        @click="read"
      >
        {{ item.read ? '已读' : '标为已读' }}
      </UButton>
    </template>
  </div>
</template>
