<script setup lang="ts">
import type { NotificationItem, NotificationSeverity, NotificationStatusFilter } from '../composables/useNotifications'

const { isNotificationsSlideoverOpen } = useDashboard()
const {
  items,
  summary,
  loading,
  error,
  status,
  nextCursor,
  loadNotifications,
  loadMore,
  markRead,
  archive,
  markAllRead
} = useNotifications()

const filters: Array<{ label: string, value: NotificationStatusFilter }> = [
  { label: '全部', value: 'all' },
  { label: '未读', value: 'unread' }
]

const severityIcon: Record<NotificationSeverity, string> = {
  info: 'i-lucide-info',
  success: 'i-lucide-circle-check',
  warning: 'i-lucide-triangle-alert',
  error: 'i-lucide-circle-alert'
}

const severityColor: Record<NotificationSeverity, 'info' | 'success' | 'warning' | 'error'> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error'
}

const severityTextClass: Record<NotificationSeverity, string> = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error'
}

watch(isNotificationsSlideoverOpen, (open) => {
  if (open) {
    void loadNotifications({ status: status.value })
  }
})

async function selectStatus(nextStatus: NotificationStatusFilter) {
  await loadNotifications({ status: nextStatus })
}

async function openNotification(item: NotificationItem) {
  if (!item.recipient.isRead) {
    await markRead(item.notificationId)
  }
  if (!item.actionUrl) return

  await navigateTo(item.actionUrl, {
    external: /^https?:\/\//i.test(item.actionUrl)
  })
}

function formatTime(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}
</script>

<template>
  <USlideover
    v-model:open="isNotificationsSlideoverOpen"
    title="通知中心"
    description="站内消息与系统通知"
    :ui="{ content: 'max-w-md' }"
  >
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <div class="flex shrink-0 items-center justify-between gap-3 border-b border-default px-4 pb-3">
          <div class="flex items-center gap-1 rounded-md bg-elevated p-1">
            <UButton
              v-for="filter in filters"
              :key="filter.value"
              :label="filter.label"
              size="xs"
              color="neutral"
              :variant="status === filter.value ? 'solid' : 'ghost'"
              @click="selectStatus(filter.value)"
            />
          </div>
          <UButton
            label="全部已读"
            icon="i-lucide-check-check"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="summary.unreadCount === 0"
            @click="markAllRead"
          />
        </div>

        <div v-if="loading && !items.length" class="flex flex-1 items-center justify-center">
          <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-dimmed" />
        </div>

        <div v-else-if="error" class="flex flex-1 items-center justify-center px-6 text-center text-sm text-error">
          {{ error }}
        </div>

        <div v-else-if="!items.length" class="flex flex-1 flex-col items-center justify-center px-6 text-center text-sm text-muted">
          <UIcon name="i-lucide-inbox" class="mb-3 size-9 text-dimmed" />
          暂无通知
        </div>

        <div v-else class="min-h-0 flex-1 overflow-y-auto">
          <div
            v-for="item in items"
            :key="item.notificationId"
            class="group border-b border-default px-4 py-3 transition-colors hover:bg-elevated/60"
          >
            <div class="flex items-start gap-3">
              <div class="relative mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-elevated">
                <UIcon
                  :name="severityIcon[item.severity]"
                  class="size-4"
                  :class="severityTextClass[item.severity]"
                />
                <span
                  v-if="!item.recipient.isRead"
                  class="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary"
                />
              </div>

              <button
                type="button"
                class="min-w-0 flex-1 text-left"
                @click="openNotification(item)"
              >
                <div class="flex items-start justify-between gap-3">
                  <p
                    class="line-clamp-2 text-sm font-medium"
                    :class="item.recipient.isRead ? 'text-muted' : 'text-highlighted'"
                  >
                    {{ item.title }}
                  </p>
                  <span class="shrink-0 text-xs text-dimmed">
                    {{ formatTime(item.createdAt) }}
                  </span>
                </div>
                <p v-if="item.summary" class="mt-1 line-clamp-2 text-xs text-muted">
                  {{ item.summary }}
                </p>
                <div class="mt-2 flex items-center gap-2">
                  <UBadge color="neutral" variant="soft" size="sm">
                    {{ item.sourceAppCode }}
                  </UBadge>
                  <UBadge :color="severityColor[item.severity]" variant="soft" size="sm">
                    {{ item.category }}
                  </UBadge>
                </div>
              </button>

              <UButton
                icon="i-lucide-archive"
                color="neutral"
                variant="ghost"
                size="xs"
                square
                class="opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="归档通知"
                @click="archive(item.notificationId)"
              />
            </div>
          </div>

          <div v-if="nextCursor" class="p-3">
            <UButton
              block
              color="neutral"
              variant="ghost"
              size="sm"
              :loading="loading"
              label="加载更多"
              @click="loadMore"
            />
          </div>
        </div>
      </div>
    </template>
  </USlideover>
</template>
