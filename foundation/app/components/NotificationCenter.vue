<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import ContentPageHeader from './ContentPageHeader.vue'

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
  listPath: string
  detailPath: (notificationId: string) => string
  serverPagination?: boolean
  hosted?: boolean
  panelUi?: { root?: string, body?: string }
}>(), {
  notificationId: '',
  hosted: false,
  serverPagination: false,
  panelUi: () => ({})
})

usePageTitle('消息中心')

const notificationColumns: TableColumn<NotificationItem>[] = [
  { accessorKey: 'displayLabel', header: '通知' },
  { accessorKey: 'createdAt', header: '时间' },
  { id: 'actions', header: '' }
]
const router = useRouter()
const { apps, loadApps } = useUserApplications()
const {
  items: legacyItems,
  summary,
  loading: legacyLoading,
  error: legacyError,
  status: legacyStatus,
  nextCursor,
  loadSummary,
  loadNotifications,
  loadMore,
  loadDetail,
  markRead,
  archive,
  markAllRead,
  pageItems, pageTotal, pageLoading, pageError, loadNotificationPage, cacheFingerprint
} = useNotifications()

const status = props.serverPagination ? ref<NotificationStatusFilter>('all') : legacyStatus
const { page, pageSize } = props.serverPagination ? useListPage({ pageSize: 20, filters: { status } }) : { page: ref(1), pageSize: 20 }
const route = props.serverPagination ? useRoute() : undefined
const items = computed(() => props.serverPagination ? pageItems.value : legacyItems.value)
const loading = computed(() => props.serverPagination ? pageLoading.value : legacyLoading.value)
const error = computed(() => props.serverPagination ? pageError.value : legacyError.value)
const listLink = computed(() => props.serverPagination ? { path: props.listPath, query: route?.query } : props.listPath)
async function loadList() {
  if (!props.serverPagination)
    return await loadNotifications({ status: status.value })
  const result = await loadNotificationPage({ status: status.value, page: page.value, pageSize })
  if (result && page.value > Math.max(1, Math.ceil(result.total / pageSize)))
    page.value = Math.max(1, Math.ceil(result.total / pageSize))
}
watch([page, status], () => {
  if (props.serverPagination)
    void loadList()
})
const selectedDetail = ref<NotificationDetail | null>(null)
const detailLoading = ref(false)
const detailErrorStatus = ref(0)
const selectedNotificationId = computed(() => String(props.notificationId || '').trim())
let detailGeneration = 0
onScopeDispose(() => {
  detailGeneration++
})
watch(cacheFingerprint, () => {
  detailGeneration++
  selectedDetail.value = null
  detailLoading.value = false
  detailErrorStatus.value = 0
  if (props.serverPagination) {
    page.value = 1
    void loadList()
  }
  if (cacheFingerprint.value && selectedNotificationId.value)
    void loadSelectedDetail()
}, { flush: 'sync' })

const notificationCenterPanelUi = computed(() => ({
  ...props.panelUi,
  body: props.hosted ? '!min-h-0 !flex-1 !overflow-y-auto !p-4 sm:!p-6' : '!min-h-0 !flex-1 !overflow-hidden !p-0'
}))

const filters: Array<{ label: string, value: NotificationStatusFilter }> = [
  { label: '全部', value: 'all' },
  { label: '未读', value: 'unread' }
]

const severityColor: Record<NotificationSeverity, 'info' | 'success' | 'warning' | 'error'> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error'
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
  if (!import.meta.client || !selectedDetail.value?.actionUrl)
    return ''
  return resolveNotificationActionUrl(selectedDetail.value, apps.value, window.location.origin, hostNotificationTarget())
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
  if (!value)
    return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function formatDate(value: string | null | undefined) {
  if (!value)
    return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    return value
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
  const epoch = ++detailGeneration, fingerprint = cacheFingerprint.value
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
    if (selectedNotificationId.value !== notificationId || epoch !== detailGeneration || fingerprint !== cacheFingerprint.value)
      return
    selectedDetail.value = detail
    try {
      await markRead(notificationId)
    } catch {
      // The authorized message remains useful if its read receipt is temporarily unavailable.
    }
  } catch (error) {
    if (selectedNotificationId.value !== notificationId || epoch !== detailGeneration || fingerprint !== cacheFingerprint.value)
      return
    detailErrorStatus.value = responseStatusCode(error)
  } finally {
    if (selectedNotificationId.value === notificationId && epoch === detailGeneration) {
      detailLoading.value = false
    }
  }
}

async function selectStatus(nextStatus: NotificationStatusFilter) {
  if (props.serverPagination) {
    status.value = nextStatus
    page.value = 1
  } else
    await loadNotifications({ status: nextStatus })
}

async function selectNotification(item: NotificationItem) {
  if (selectedNotificationId.value === item.notificationId) {
    await loadSelectedDetail(item.notificationId)
    return
  }
  if (props.serverPagination)
    await router.push({ path: props.detailPath(item.notificationId), query: route?.query })
  else
    await router.push(props.detailPath(item.notificationId))
}

async function archiveNotification(item: NotificationItem) {
  await archive(item.notificationId)
  if (props.serverPagination)
    await loadList()
  if (selectedNotificationId.value === item.notificationId) {
    if (props.serverPagination)
      await router.push(listLink.value)
    else
      await router.push(props.listPath)
  }
}

async function markEverythingRead() {
  if (props.serverPagination)
    await markAllRead({ status: status.value })
  else
    await markAllRead()
  await loadList()
}

async function reloadCenter() {
  await Promise.all([
    loadApps(),
    loadSummary(),
    loadList()
  ])
  if (selectedNotificationId.value) {
    await loadSelectedDetail()
  }
}

async function openAction() {
  if (!actionUrl.value)
    return
  await navigateTo(actionUrl.value, {
    external: /^https?:\/\//i.test(actionUrl.value)
  })
}

watch(selectedNotificationId, (notificationId) => {
  if (!import.meta.client)
    return
  void loadSelectedDetail(notificationId)
})

onMounted(async () => {
  await Promise.all([
    loadApps(),
    loadSummary(),
    props.serverPagination ? loadList() : loadNotifications({ status: 'all' })
  ])
  if (selectedNotificationId.value) {
    await loadSelectedDetail()
  }
})
</script>

<template>
  <UDashboardPanel id="notification-center" :ui="notificationCenterPanelUi">
    <template v-if="!hosted" #header>
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
      <ContentPageHeader
        v-if="hosted"
        title="消息中心"
        :hosted="true"
        description="查看个人通知与消息详情。"
      >
        <template #actions>
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
      </ContentPageHeader>
      <div class="notification-center-layout" :class="{ 'has-selection': selectedNotificationId }">
        <section
          aria-label="消息列表"
          class="notification-list min-h-0 min-w-0 flex-col border-default"
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

          <div v-if="error" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
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

          <div v-else class="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <UTable
              :data="items"
              :columns="notificationColumns"
              :loading="loading"
              class="notification-table"
            >
              <template #displayLabel-cell="{ row }">
                <button type="button" class="notification-label text-left" @click="selectNotification(row.original)">
                  <span class="line-clamp-2 text-sm font-medium text-highlighted">{{ row.original.displayLabel }}</span>
                  <span class="mt-2 flex flex-wrap gap-2">
                    <UBadge color="neutral" variant="subtle" size="xs">{{ row.original.sourceAppCode }}</UBadge>
                    <UBadge :color="severityColor[row.original.severity]" variant="subtle" size="xs">{{ row.original.category }}</UBadge>
                    <UBadge color="neutral" variant="subtle" size="xs">{{ row.original.recipient.isRead ? '已读' : '未读' }}</UBadge>
                  </span>
                </button>
              </template>
              <template #createdAt-cell="{ row }">
                <span class="text-xs text-muted">{{ formatListTime(row.original.createdAt) }}</span>
              </template>
              <template #actions-cell="{ row }">
                <UButton
                  icon="i-lucide-archive"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  aria-label="归档消息"
                  @click="archiveNotification(row.original)"
                />
              </template>
              <template #empty>
                <CommonEmptyState icon="i-lucide-inbox" title="暂无消息" description="新消息会出现在这里。" />
              </template>
            </UTable>
            <div class="flex flex-wrap items-center justify-between gap-3 p-3">
              <span v-if="serverPagination" class="text-sm text-muted">共 {{ pageTotal }} 条</span>
              <UPagination
                v-if="serverPagination"
                v-model:page="page"
                :items-per-page="pageSize"
                :total="pageTotal"
                :sibling-count="0"
              />
              <span v-else class="text-sm text-muted">已加载 {{ items.length }} 条<span v-if="nextCursor">，还有更多</span></span>
              <UButton
                v-if="!serverPagination && nextCursor"
                color="neutral"
                variant="outline"
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
          class="notification-detail min-h-0 min-w-0 flex-col overflow-y-auto"
        >
          <div v-if="selectedNotificationId" class="flex shrink-0 items-center gap-2 border-b border-default px-3 py-2 lg:hidden">
            <UButton
              :to="listLink"
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

          <div v-else class="flex min-w-0 w-full flex-col gap-4 p-4 sm:p-6">
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

<style scoped>
.notification-center-layout { display: grid; grid-template-columns: minmax(0, 1fr); min-height: 0; flex: 1; container-type: inline-size; }
.notification-list { display: flex; }
.notification-detail { display: none; }
.has-selection > .notification-list { display: none; }
.has-selection > .notification-detail { display: flex; }
.notification-table { width: 100%; }
.notification-label { width: 100%; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.notification-table :deep(table) { table-layout: fixed; }
.notification-table :deep(th:nth-child(2)) { width: 5rem; }
.notification-table :deep(th:nth-child(3)) { width: 3rem; }
@media (min-width: 1024px) {
  .notification-center-layout { grid-template-columns: minmax(20rem, 24rem) minmax(0, 1fr); }
  .notification-center-layout > .notification-list { display: flex; border-right: 1px solid var(--ui-border); }
  .notification-center-layout > .notification-detail { display: flex; }
}
</style>
