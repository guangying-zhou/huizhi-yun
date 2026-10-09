<script setup lang="ts">
import type { AnnouncementPage } from '../../../../../console/shared/announcements'

definePageMeta({ name: 'console-host-announcements', navigationOwner: 'console' })
const page = ref(1)
const { data, error, status, refresh } = await useFetch<AnnouncementPage>('/enterprise/api/announcements', { query: { page }, server: false })
</script>

<template>
  <div class="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6">
    <ContentPageHeader
      hosted
      title="系统公告"
      description="查看当前有效、对本人可见的公告。"
    />
    <UButton
      to="/enterprise/help"
      icon="i-lucide-book-open"
      variant="soft"
    >
      使用说明（文档与项目）
    </UButton>
    <UAlert
      v-if="error"
      color="error"
      :title="error.statusCode === 403 ? '无权查看系统公告' : '系统公告暂不可用'"
      :actions="[{ label: '重试', onClick: () => refresh() }]"
    />
    <p
      v-else-if="status === 'pending'"
      role="status"
    >
      正在加载公告…
    </p>
    <template v-else>
      <UCard
        v-for="item in data?.data.items"
        :key="item.id"
      >
        <div class="flex flex-wrap items-center gap-2">
          <UBadge :color="item.level === 'warning' ? 'warning' : 'info'">
            {{ item.level === 'warning' ? '重要提醒' : '通知' }}
          </UBadge><span class="text-sm text-muted">{{ item.read ? '已读' : '未读' }}</span>
        </div>
        <NuxtLink
          :to="`/enterprise/announcements/${item.id}`"
          class="mt-2 block text-lg font-semibold underline"
        >{{ item.title }}</NuxtLink>
        <p class="text-sm text-muted">
          生效时间：{{ new Date(item.startsAt).toLocaleString() }}
        </p>
      </UCard>
      <p
        v-if="!data?.data.items.length"
        class="text-muted"
      >
        当前没有可见公告。
      </p>
      <div class="flex gap-2">
        <UButton
          :disabled="page === 1"
          variant="outline"
          @click="page--"
        >
          上一页
        </UButton><span class="self-center">第 {{ page }} 页</span><UButton
          :disabled="!data?.data.hasMore"
          variant="outline"
          @click="page++"
        >
          下一页
        </UButton>
      </div>
    </template>
  </div>
</template>
