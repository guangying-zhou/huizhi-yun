<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'
type NotificationStatusFilter = 'all' | 'unread' | 'read' | 'archived'

interface NotificationItem {
  notificationId: string
  sourceAppCode: string
  category: string
  severity: NotificationSeverity
  displayLabel: string
  createdAt: string
  expiresAt: string | null
  recipient: {
    readAt: string | null
    archivedAt: string | null
    pinnedAt: string | null
    isRead: boolean
    isArchived: boolean
  }
}

interface NotificationDetail {
  notificationId: string
  sourceAppCode: string
  title: string
  summary: string | null
  body: string | null
  actionUrl: string | null
  actionTargetAppCode: string
  bizType: string | null
  bizId: string | null
  createdAt: string
  expiresAt: string | null
}

const props = withDefaults(defineProps<{
  notificationId?: string
}>(), {
  notificationId: ''
})

usePageTitle('消息中心')

const router = useRouter()
const { apps, loadApps } = useUserApplications()
const {
  items,
  summary,
  loading,
  error,
  status,
  nextCursor,
  loadSummary,
  loadNotifications,
  loadMore,
  loadDetail,
  markRead,
  archive,
  markAllRead
} = useNotifications()

const selectedDetail = ref<NotificationDetail | null>(null)
const detailLoading = ref(false)
const detailErrorStatus = ref(0)
const selectedNotificationId = computed(() => String(props.notificationId || '').trim())
const notificationCenterPanelUi = {
  ...dashboardPanelUi,
  body: '!min-h-0 !flex-1 !overflow-hidden !p-0'
}

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

function responseStatusCode(error: unknown) {
  const candidate = error as {
    status?: number
    statusCode?: number
    response?: { status?: number, statusCode?: number }
  }
  return Number(
    candidate?.statusCode
    || candidate?.status
    || candidate?.response?.statusCode
    || candidate?.response?.status
    || 0
  )
}

function formatListTime(value: string | null | undefined) {
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

async function loadSelectedDetail(notificationId = selectedNotificationId.value) {
  if (!notificationId) {
    selectedDetail.value = null
    detailErrorStatus.value = 0
    return
  }

  selectedDetail.value = null
  detailErrorStatus.value = 0
  detailLoading.value = true
  try {
    const detail = await loadDetail(notificationId)
    if (selectedNotificationId.value !== notificationId) return
    selectedDetail.value = detail
    try {
      await markRead(notificationId)
    } catch {
      // The authorized message remains useful if its read receipt is temporarily unavailable.
    }
  } catch (error) {
    if (selectedNotificationId.value !== notificationId) return
    detailErrorStatus.value = responseStatusCode(error)
  } finally {
    if (selectedNotificationId.value === notificationId) {
      detailLoading.value = false
    }
  }
}

async function selectStatus(nextStatus: NotificationStatusFilter) {
  await loadNotifications({ status: nextStatus })
}

async function selectNotification(item: NotificationItem) {
  if (selectedNotificationId.value === item.notificationId) {
    await loadSelectedDetail(item.notificationId)
    return
  }
  await router.push(`/notifications/${encodeURIComponent(item.notificationId)}`)
}

async function archiveNotification(item: NotificationItem) {
  await archive(item.notificationId)
  if (selectedNotificationId.value === item.notificationId) {
    await router.push('/notifications')
  }
}

async function markEverythingRead() {
  await markAllRead()
  await loadNotifications({ status: status.value })
}

async function reloadCenter() {
  await Promise.all([
    loadApps(),
    loadSummary(),
    loadNotifications({ status: status.value })
  ])
  if (selectedNotificationId.value) {
    await loadSelectedDetail()
  }
}

async function openAction() {
  if (!actionUrl.value) return
  await navigateTo(actionUrl.value, {
    external: /^https?:\/\//i.test(actionUrl.value)
  })
}

watch(selectedNotificationId, (notificationId) => {
  if (!import.meta.client) return
  void loadSelectedDetail(notificationId)
})

onMounted(async () => {
  await Promise.all([
    loadApps(),
    loadSummary(),
    loadNotifications({ status: 'all' })
  ])
  if (selectedNotificationId.value) {
    await loadSelectedDetail()
  }
})
</script>

<template>
  <UDashboardPanel id="notification-center" :ui="notificationCenterPanelUi">
    <template #header>
      <UDashboardNavbar title="消息中心">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UBadge v-if="summary.unreadCount" color="primary" variant="soft">
            {{ summary.unreadCount }} 条未读
          </UBadge>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            :loading="loading || detailLoading"
            aria-label="刷新消息中心"
            @click="reloadCenter"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="grid h-full min-h-0 lg:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]">
        <section
          aria-label="消息列表"
          class="min-h-0 flex-col border-default lg:flex lg:border-r"
          :class="selectedNotificationId ? 'hidden' : 'flex'"
        >
          <div class="flex shrink-0 items-center justify-between gap-3 border-b border-default px-4 py-3">
            <div class="flex items-center gap-1 rounded-lg bg-elevated p-1">
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
              @click="markEverythingRead"
            />
          </div>

          <div v-if="loading && !items.length" class="flex min-h-0 flex-1 items-center justify-center">
            <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-dimmed" />
          </div>

          <div v-else-if="error" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <UIcon name="i-lucide-circle-alert" class="size-9 text-error" />
            <div>
              <h2 class="text-sm font-semibold text-highlighted">
                消息列表暂时不可用
              </h2>
              <p class="mt-2 text-sm text-muted">
                {{ error }}
              </p>
            </div>
            <UButton
              label="重新加载"
              icon="i-lucide-refresh-cw"
              variant="soft"
              @click="reloadCenter"
            />
          </div>

          <div v-else-if="!items.length" class="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
            <UIcon name="i-lucide-inbox" class="size-10 text-dimmed" />
            <h2 class="mt-4 text-sm font-semibold text-highlighted">
              暂无消息
            </h2>
            <p class="mt-1 text-sm text-muted">
              新消息会出现在这里。
            </p>
          </div>

          <div v-else class="min-h-0 flex-1 overflow-y-auto">
            <article
              v-for="item in items"
              :key="item.notificationId"
              class="group border-b border-default px-4 py-3 transition-colors hover:bg-elevated/60"
              :class="selectedNotificationId === item.notificationId ? 'bg-elevated/70' : ''"
            >
              <div class="flex items-start gap-3">
                <div class="relative mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-elevated">
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
                  @click="selectNotification(item)"
                >
                  <div class="flex items-start justify-between gap-3">
                    <p
                      class="line-clamp-2 text-sm font-medium"
                      :class="item.recipient.isRead ? 'text-muted' : 'text-highlighted'"
                    >
                      {{ item.displayLabel }}
                    </p>
                    <span class="shrink-0 text-xs text-dimmed">
                      {{ formatListTime(item.createdAt) }}
                    </span>
                  </div>
                  <div class="mt-2 flex flex-wrap items-center gap-2">
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
                  class="opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100"
                  aria-label="归档消息"
                  @click="archiveNotification(item)"
                />
              </div>
            </article>

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
        </section>

        <section
          aria-label="消息详情"
          class="min-h-0 flex-col overflow-y-auto"
          :class="selectedNotificationId ? 'flex' : 'hidden lg:flex'"
        >
          <div v-if="selectedNotificationId" class="flex shrink-0 items-center gap-2 border-b border-default px-3 py-2 lg:hidden">
            <UButton
              to="/notifications"
              icon="i-lucide-arrow-left"
              label="返回消息列表"
              color="neutral"
              variant="ghost"
            />
          </div>

          <div v-if="!selectedNotificationId" class="flex min-h-full flex-col items-center justify-center px-8 text-center">
            <div class="flex size-14 items-center justify-center rounded-2xl bg-elevated">
              <UIcon name="i-lucide-message-square-text" class="size-7 text-dimmed" />
            </div>
            <h2 class="mt-5 text-base font-semibold text-highlighted">
              选择一条消息查看详情
            </h2>
            <p class="mt-2 max-w-sm text-sm leading-6 text-muted">
              消息正文会在通过实时业务授权后显示。
            </p>
          </div>

          <div v-else-if="detailLoading && !selectedDetail" class="flex min-h-full items-center justify-center">
            <UIcon name="i-lucide-loader-2" class="size-7 animate-spin text-dimmed" />
          </div>

          <div v-else-if="!selectedDetail" class="flex min-h-full flex-col items-center justify-center gap-4 px-8 text-center">
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
              @click="loadSelectedDetail()"
            />
          </div>

          <div v-else class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6 lg:p-8">
            <UCard>
              <template #header>
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
                    <h1 class="mt-3 break-words text-xl font-semibold text-highlighted sm:text-2xl">
                      {{ selectedDetail.title }}
                    </h1>
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
              </template>

              <section aria-labelledby="notification-center-message-heading">
                <h2 id="notification-center-message-heading" class="text-sm font-semibold text-highlighted">
                  消息内容
                </h2>
                <p class="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-default">
                  {{ selectedDetail.body || selectedDetail.summary || '该消息没有补充内容。' }}
                </p>
              </section>

              <template #footer>
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p class="break-all text-xs text-dimmed">
                    消息编号：{{ selectedDetail.notificationId }}
                  </p>
                  <UButton
                    v-if="actionUrl"
                    label="前往处理"
                    icon="i-lucide-arrow-up-right"
                    trailing
                    @click="openAction"
                  />
                </div>
              </template>
            </UCard>

            <UAlert
              v-if="selectedDetail.actionUrl && !actionUrl"
              color="warning"
              variant="soft"
              icon="i-lucide-route-off"
              title="业务入口当前不可用"
              description="消息内容仍可查看，但目标应用未出现在当前授权应用列表中。"
            />
          </div>
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
