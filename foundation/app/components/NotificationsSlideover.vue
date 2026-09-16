<script setup lang="ts">
import type {
  NotificationDetail,
  NotificationItem,
  NotificationSeverity,
  NotificationStatusFilter
} from '../composables/useNotifications'

const { isNotificationsSlideoverOpen } = useDashboard()
const { apps, loadApps } = useUserApplications()
const {
  items,
  summary,
  loading,
  error,
  status,
  nextCursor,
  loadNotifications,
  loadMore,
  loadDetail,
  markRead,
  archive,
  markAllRead
} = useNotifications()
const openingNotificationIds = ref(new Set<string>())
const detailOpen = ref(false)
const selectedNotificationId = ref('')
const selectedDetail = ref<NotificationDetail | null>(null)
const detailLoading = ref(false)
const detailErrorStatus = ref(0)

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

const detailErrorPresentation = computed(() => {
  if (detailErrorStatus.value === 403) {
    return {
      icon: 'i-lucide-shield-alert',
      title: '当前无权查看此消息',
      description: '您的业务对象权限可能已发生变化，消息内容不会继续展示。',
      color: 'warning' as const
    }
  }
  if (detailErrorStatus.value === 404) {
    return {
      icon: 'i-lucide-file-question',
      title: '消息不存在或已过期',
      description: '该消息可能已被清理，或不属于当前登录用户。',
      color: 'neutral' as const
    }
  }
  return {
    icon: 'i-lucide-circle-alert',
    title: '消息详情暂时不可用',
    description: '实时授权未能完成，请稍后重新加载。',
    color: 'error' as const
  }
})

const actionUrl = computed(() => {
  if (!import.meta.client || !selectedDetail.value?.actionUrl) return ''
  return resolveNotificationActionUrl(selectedDetail.value, apps.value, window.location.origin)
})

watch(isNotificationsSlideoverOpen, (open) => {
  if (open) {
    void loadNotifications({ status: status.value })
  }
})

onMounted(() => {
  void loadApps()
})

async function selectStatus(nextStatus: NotificationStatusFilter) {
  await loadNotifications({ status: nextStatus })
}

async function openNotification(item: NotificationItem) {
  if (openingNotificationIds.value.has(item.notificationId)) return
  selectedNotificationId.value = item.notificationId
  selectedDetail.value = null
  detailErrorStatus.value = 0
  detailOpen.value = true
  detailLoading.value = true
  openingNotificationIds.value = new Set(openingNotificationIds.value).add(item.notificationId)
  try {
    void loadApps()
    const detail = await loadDetail(item.notificationId)
    if (selectedNotificationId.value !== item.notificationId) return
    selectedDetail.value = detail
    try {
      await markRead(item.notificationId)
    } catch {
      // The authorized message remains readable if the read receipt is temporarily unavailable.
    }
  } catch (error) {
    if (selectedNotificationId.value !== item.notificationId) return
    detailErrorStatus.value = responseStatusCode(error)
  } finally {
    const next = new Set(openingNotificationIds.value)
    next.delete(item.notificationId)
    openingNotificationIds.value = next
    if (selectedNotificationId.value === item.notificationId) {
      detailLoading.value = false
    }
  }
}

function responseStatusCode(error: unknown) {
  const candidate = error as {
    status?: number
    statusCode?: number
    response?: { status?: number, statusCode?: number }
  }
  return Number(candidate?.statusCode || candidate?.status || candidate?.response?.statusCode || candidate?.response?.status || 0)
}

async function reloadSelectedNotification() {
  const item = items.value.find(candidate => candidate.notificationId === selectedNotificationId.value)
  if (item) await openNotification(item)
}

async function openAction() {
  if (!actionUrl.value) return
  detailOpen.value = false
  isNotificationsSlideoverOpen.value = false
  await navigateTo(actionUrl.value, {
    external: /^https?:\/\//i.test(actionUrl.value)
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

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
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
                    {{ item.displayLabel }}
                  </p>
                  <span class="shrink-0 text-xs text-dimmed">
                    {{ formatTime(item.createdAt) }}
                  </span>
                </div>
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
                v-if="openingNotificationIds.has(item.notificationId)"
                icon="i-lucide-loader-2"
                color="neutral"
                variant="ghost"
                size="xs"
                square
                loading
                aria-label="正在验证通知权限"
              />

              <UButton
                v-else
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

  <UModal
    v-model:open="detailOpen"
    title="消息详情"
    :description="selectedDetail ? `${selectedDetail.sourceAppCode} · 实时授权内容` : '正在读取实时授权内容'"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div v-if="detailLoading && !selectedDetail" class="flex min-h-64 items-center justify-center">
        <UIcon name="i-lucide-loader-2" class="size-7 animate-spin text-dimmed" />
      </div>

      <div v-else-if="!selectedDetail" class="flex min-h-64 flex-col items-center justify-center gap-4 text-center">
        <UIcon :name="detailErrorPresentation.icon" class="size-10 text-dimmed" />
        <div class="max-w-lg">
          <h2 class="text-lg font-semibold text-highlighted">
            {{ detailErrorPresentation.title }}
          </h2>
          <p class="mt-2 text-sm text-muted">
            {{ detailErrorPresentation.description }}
          </p>
        </div>
        <UButton
          label="重新加载"
          icon="i-lucide-refresh-cw"
          :color="detailErrorPresentation.color"
          variant="soft"
          @click="reloadSelectedNotification"
        />
      </div>

      <div v-else class="space-y-5">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge color="neutral" variant="soft">
                {{ selectedDetail.sourceAppCode }}
              </UBadge>
              <UBadge v-if="selectedDetail.bizType" color="info" variant="soft">
                {{ selectedDetail.bizType }}
              </UBadge>
            </div>
            <h2 class="mt-3 text-xl font-semibold text-highlighted">
              {{ selectedDetail.title }}
            </h2>
            <p v-if="selectedDetail.summary" class="mt-2 text-sm leading-6 text-muted">
              {{ selectedDetail.summary }}
            </p>
          </div>
          <div class="shrink-0 text-xs text-dimmed sm:text-right">
            <p>{{ formatDate(selectedDetail.createdAt) }}</p>
            <p v-if="selectedDetail.expiresAt" class="mt-1">
              有效期至 {{ formatDate(selectedDetail.expiresAt) }}
            </p>
          </div>
        </div>

        <USeparator />

        <section aria-labelledby="notification-modal-message-heading">
          <h3 id="notification-modal-message-heading" class="text-sm font-semibold text-highlighted">
            消息内容
          </h3>
          <p class="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-default">
            {{ selectedDetail.body || selectedDetail.summary || '该消息没有补充内容。' }}
          </p>
        </section>

        <UAlert
          v-if="selectedDetail.actionUrl && !actionUrl"
          color="warning"
          variant="soft"
          icon="i-lucide-route-off"
          title="业务入口当前不可用"
          description="消息内容仍可查看，但目标应用未出现在当前授权应用列表中。"
        />
      </div>
    </template>

    <template v-if="selectedDetail" #footer>
      <div class="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p class="break-all text-xs text-dimmed">
          消息编号：{{ selectedDetail.notificationId }}
        </p>
        <div class="flex shrink-0 justify-end gap-2">
          <UButton
            label="关闭"
            color="neutral"
            variant="ghost"
            @click="detailOpen = false"
          />
          <UButton
            v-if="actionUrl"
            label="前往处理"
            icon="i-lucide-arrow-up-right"
            trailing
            @click="openAction"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
