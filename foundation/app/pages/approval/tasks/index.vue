<script setup lang="ts">
import type {
  WorkflowTaskItem,
  WorkflowInitiatedItem,
  WorkflowPagedResponse
} from '../../../types/workflow'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useAccountStore } from '../../../stores/account'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '审批中心'
})

usePageTitle('审批中心')

const config = useRuntimeConfig()
const runtimePublic = config.public as Record<string, unknown>
const runtimeAppCode = String(runtimePublic.appCode || runtimePublic.appName || '')

const { enterApprovalMode } = useApprovalMode()
const { user: authUserUid } = useAuth()
const accountStore = useAccountStore()
const { apps, loadApps } = useUserApplications()

const searchQuery = ref('')
const compactMode = ref(false)
const pendingData = ref<WorkflowPagedResponse<WorkflowTaskItem>>({ total: 0, items: [] })
const doneData = ref<WorkflowPagedResponse<WorkflowTaskItem>>({ total: 0, items: [] })
const initiatedData = ref<WorkflowPagedResponse<WorkflowInitiatedItem>>({ total: 0, items: [] })
const pendingLoading = ref(false)
const doneLoading = ref(false)
const initiatedLoading = ref(false)
const lastSyncedAt = ref<string | null>(null)

const pageSize = 10

function getUserName(uid: string | null | undefined) {
  if (!uid) return '未知'
  const user = accountStore.getUserByUid(uid)
  return user?.realName || user?.nickname || uid
}

function getUserInitial(uid: string | null | undefined) {
  const name = getUserName(uid).trim()
  return (name[0] || '?').toUpperCase()
}

function formatRelativeTime(dateStr: string) {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: zhCN })
  } catch {
    return dateStr
  }
}

function formatClock(dateStr: string | null | undefined) {
  if (!dateStr) return '未设时间'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(dateStr))
  } catch {
    return dateStr
  }
}

function isOverdue(dueAt: string | null | undefined) {
  if (!dueAt) return false
  return new Date(dueAt).getTime() < Date.now()
}

function matchesKeyword(fields: Array<string | null | undefined>) {
  const keyword = searchQuery.value.trim().toLowerCase()
  if (!keyword) return true
  return fields
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(keyword)
}

async function loadPending() {
  pendingLoading.value = true
  try {
    const res = await fetchPendingTasks({
      page: 1,
      page_size: pageSize
    })
    if (res.code === 0) pendingData.value = res.data
  } catch {
    // silent
  } finally {
    pendingLoading.value = false
  }
}

async function loadDone() {
  doneLoading.value = true
  try {
    const res = await fetchDoneTasks({
      page: 1,
      page_size: pageSize
    })
    if (res.code === 0) doneData.value = res.data
  } catch {
    // silent
  } finally {
    doneLoading.value = false
  }
}

async function loadInitiated() {
  initiatedLoading.value = true
  try {
    const res = await fetchInitiatedTasks({
      page: 1,
      page_size: pageSize
    })
    if (res.code === 0) initiatedData.value = res.data
  } catch {
    // silent
  } finally {
    initiatedLoading.value = false
  }
}

async function loadBoard() {
  await Promise.all([loadPending(), loadDone(), loadInitiated()])
  lastSyncedAt.value = new Date().toISOString()
}

async function preloadUsers(uids: string[]) {
  const unique = [...new Set(uids.filter(Boolean))]
  if (unique.length) {
    accountStore.fetchUsersBatch(unique).catch(() => {})
  }
}

watch([pendingData, doneData, initiatedData], ([pending, done, _initiated]) => {
  preloadUsers([
    ...pending.items.map(item => item.initiator_uid),
    ...done.items.map(item => item.initiator_uid)
  ])
})

onMounted(() => {
  loadApps()
  loadBoard()
})

type BadgeColor = 'error' | 'info' | 'success' | 'primary' | 'secondary' | 'warning' | 'neutral'
const statusMap: Record<string, { label: string, color: BadgeColor }> = {
  running: { label: '审批中', color: 'warning' },
  approved: { label: '已通过', color: 'success' },
  rejected: { label: '已驳回', color: 'error' },
  cancelled: { label: '已撤销', color: 'neutral' },
  suspended: { label: '已挂起', color: 'info' }
}

const isBoardLoading = computed(() => {
  return pendingLoading.value || doneLoading.value || initiatedLoading.value
})

const pendingItems = computed(() => {
  return pendingData.value.items.filter(item => matchesKeyword([
    item.biz_title,
    item.action_name,
    item.action_code,
    item.node_name,
    item.instance_no,
    item.app_code,
    getUserName(item.initiator_uid)
  ]))
})

const doneItems = computed(() => {
  return doneData.value.items.filter(item => matchesKeyword([
    item.biz_title,
    item.action_name,
    item.action_code,
    item.node_name,
    item.instance_no,
    item.app_code,
    getUserName(item.initiator_uid)
  ]))
})

const initiatedItems = computed(() => {
  return initiatedData.value.items.filter(item => matchesKeyword([
    item.biz_title,
    item.action_name,
    item.action_code,
    item.instance_no,
    item.app_code,
    getUserName(authUserUid.value)
  ]))
})

const overdueCount = computed(() => {
  return pendingData.value.items.filter(item => isOverdue(item.due_at)).length
})

function isAbsoluteUrl(value: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('//')
}

function fallbackApprovalTarget(item: WorkflowTaskItem, mode: 'task' | 'instance' = 'task') {
  if (mode === 'instance') {
    return `/approval/tasks/${item.instance_id}?mode=instance`
  }
  return `/approval/tasks/${item.task_id}`
}

function appendApprovalMode(urlValue: string, item: WorkflowTaskItem | WorkflowInitiatedItem, mode: 'task' | 'instance') {
  if (!import.meta.client) return urlValue

  const url = new URL(urlValue, window.location.origin)
  if (mode === 'task' && 'task_id' in item) {
    url.searchParams.set('hzy_approval_task_id', String(item.task_id))
  } else {
    url.searchParams.set('hzy_approval_instance_id', String(item.instance_id))
  }

  if (!isAbsoluteUrl(urlValue) && url.origin === window.location.origin) {
    return `${url.pathname}${url.search}${url.hash}`
  }
  return url.toString()
}

function resolveAppRelativeUrl(appHomeUrl: string, relativeUrl: string) {
  const url = new URL(appHomeUrl, window.location.origin)
  const relativePath = relativeUrl.replace(/^\/+/, '')
  if (!relativePath) return url.toString()

  const [pathname = '', hashPart = ''] = relativePath.split('#', 2)
  const [pathPart = '', searchPart = ''] = pathname.split('?', 2)
  const basePath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
  url.pathname = `${basePath}${pathPart}`.replace(/\/{2,}/g, '/')
  url.search = searchPart ? `?${searchPart}` : ''
  url.hash = hashPart ? `#${hashPart}` : ''
  return url.toString()
}

function getApplicationHomeUrl(appCode: string) {
  return apps.value.find(app => app.appCode === appCode)?.homeUrl || null
}

function isLocalDevHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function inferLocalAppHomeUrl(appCode: string, bizUrl: string) {
  if (!import.meta.client || !appCode) return null

  try {
    const url = new URL(bizUrl, window.location.origin)
    if (!isLocalDevHost(url.hostname)) return null
    return `${window.location.origin}/${appCode}/`
  } catch {
    return null
  }
}

function stripAppBasePath(pathname: string, appHomePathname: string) {
  const basePath = appHomePathname.endsWith('/') ? appHomePathname : `${appHomePathname}/`
  const basePathWithoutSlash = basePath.replace(/\/$/, '') || '/'

  if (basePathWithoutSlash !== '/' && pathname === basePathWithoutSlash) {
    return '/'
  }

  if (basePathWithoutSlash !== '/' && pathname.startsWith(basePath)) {
    return `/${pathname.slice(basePath.length)}`
  }

  return pathname
}

function normalizeBusinessUrlForApp(appCode: string, bizUrl: string) {
  const appHomeUrl = getApplicationHomeUrl(appCode) || inferLocalAppHomeUrl(appCode, bizUrl)
  if (!appHomeUrl || !import.meta.client) return bizUrl

  const sourceUrl = new URL(bizUrl, window.location.origin)
  const appHome = new URL(appHomeUrl, window.location.origin)
  const appBasePath = appHome.pathname.endsWith('/') ? appHome.pathname : `${appHome.pathname}/`

  if (
    sourceUrl.origin === appHome.origin
    && (sourceUrl.pathname === appBasePath.replace(/\/$/, '') || sourceUrl.pathname.startsWith(appBasePath))
  ) {
    return sourceUrl.toString()
  }

  const relativePath = stripAppBasePath(sourceUrl.pathname, appHome.pathname)
  return resolveAppRelativeUrl(appHomeUrl, `${relativePath}${sourceUrl.search}${sourceUrl.hash}`)
}

function getBusinessTarget(item: WorkflowTaskItem | WorkflowInitiatedItem, mode: 'task' | 'instance') {
  const bizUrl = String(item.biz_url || '').trim()
  if (!bizUrl) return null

  if (isAbsoluteUrl(bizUrl)) {
    return appendApprovalMode(normalizeBusinessUrlForApp(item.app_code, bizUrl), item, mode)
  }

  if (item.app_code === runtimeAppCode) {
    return appendApprovalMode(bizUrl.startsWith('/') ? bizUrl : `/${bizUrl}`, item, mode)
  }

  const appHomeUrl = getApplicationHomeUrl(item.app_code)
  if (!appHomeUrl || !import.meta.client) return null
  return appendApprovalMode(resolveAppRelativeUrl(appHomeUrl, bizUrl), item, mode)
}

async function navigateToWorkflowTarget(target: string) {
  if (isAbsoluteUrl(target)) {
    await navigateTo(target, { external: true })
    return
  }
  await navigateTo(target)
}

async function getApprovalTarget(item: WorkflowTaskItem, mode: 'task' | 'instance' = 'task') {
  if (!apps.value.length) {
    await loadApps()
  }

  const businessTarget = getBusinessTarget(item, mode)
  if (businessTarget) return businessTarget
  return fallbackApprovalTarget(item, mode)
}

function getInitiatedFallbackTarget(item: WorkflowInitiatedItem) {
  return `/approval/tasks/${item.instance_id}?mode=instance`
}

async function getInitiatedTarget(item: WorkflowInitiatedItem) {
  if (!apps.value.length) {
    await loadApps()
  }

  const businessTarget = getBusinessTarget(item, 'instance')
  if (businessTarget) return businessTarget
  return getInitiatedFallbackTarget(item)
}

async function navigateToApproval(item: WorkflowTaskItem) {
  enterApprovalMode({ taskId: item.task_id })
  await navigateToWorkflowTarget(await getApprovalTarget(item, 'task'))
}

async function navigateToApprovalDone(item: WorkflowTaskItem) {
  enterApprovalMode({ instanceId: item.instance_id })
  await navigateToWorkflowTarget(await getApprovalTarget(item, 'instance'))
}

async function navigateToInitiated(item: WorkflowInitiatedItem) {
  enterApprovalMode({ instanceId: item.instance_id })
  await navigateToWorkflowTarget(await getInitiatedTarget(item))
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-default">
    <div class="flex-1 min-h-0 overflow-y-auto px-4 pb-8 pt-5 sm:px-6 lg:px-8">
      <div class="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <UCard>
          <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div class="flex flex-1 flex-col gap-4 lg:flex-row lg:items-center">
              <div class="relative max-w-xl flex-1">
                <UIcon
                  name="i-lucide-search"
                  class="pointer-events-none absolute left-4 top-1/2 z-10 size-4 -translate-y-1/2 text-dimmed"
                />
                <UInput
                  v-model="searchQuery"
                  size="lg"
                  placeholder="搜索审批事项、动作名称、发起人或流程编号..."
                  :ui="{ base: 'pl-11' }"
                />
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <UBadge
                  v-if="overdueCount > 0"
                  color="error"
                  variant="subtle"
                  size="sm"
                >
                  {{ overdueCount }} 条待办超时
                </UBadge>
                <UBadge
                  v-if="searchQuery.trim()"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                >
                  已过滤
                </UBadge>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-end gap-2">
              <p class="text-xs text-muted">
                最近同步 {{ lastSyncedAt ? formatRelativeTime(lastSyncedAt) : '尚未同步' }}
              </p>
              <UButton
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="outline"
                size="sm"
                :loading="isBoardLoading"
                @click="loadBoard"
              >
                刷新
              </UButton>
            </div>
          </div>
        </UCard>

        <div class="grid gap-4 lg:grid-cols-3">
          <div class="approval-board-column approval-board-column--pending min-w-0 overflow-hidden rounded-xl">
            <div class="flex items-center justify-between px-3 py-2 rounded-t-lg bg-primary/5">
              <div class="min-w-0">
                <span class="font-medium text-sm">待办</span>
              </div>
              <UBadge color="primary" variant="subtle" size="xs">
                {{ pendingItems.length }} / {{ pendingData.total }}
              </UBadge>
            </div>
            <div class="space-y-3 p-3 bg-elevated/40 rounded-b-lg min-h-32">
              <div v-if="pendingLoading" class="flex min-h-56 items-center justify-center">
                <UIcon name="i-lucide-loader-2" class="size-7 animate-spin text-primary" />
              </div>
              <div v-else-if="pendingItems.length === 0" class="flex min-h-56 flex-col items-center justify-center text-center text-muted">
                <UIcon name="i-lucide-inbox" class="mb-3 size-10 text-primary/60" />
                <p class="text-sm font-medium text-highlighted">
                  暂无待办
                </p>
                <p class="mt-1 text-xs">
                  {{ searchQuery.trim() ? '调整搜索条件后再试' : '当前没有需要你处理的审批事项' }}
                </p>
              </div>
              <UCard
                v-for="item in pendingItems"
                :key="item.task_id"
                class="cursor-pointer overflow-hidden"
                :ui="{ body: compactMode ? 'p-3 space-y-3' : 'p-3 space-y-4' }"
                @click="navigateToApproval(item)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <UBadge color="neutral" variant="subtle" size="xs">
                      {{ item.action_name || item.action_code }}
                    </UBadge>
                    <UBadge
                      color="primary"
                      variant="subtle"
                      size="xs"
                    >
                      {{ item.app_code }}
                    </UBadge>
                    <UBadge
                      v-if="item.due_at"
                      :color="isOverdue(item.due_at) ? 'error' : 'warning'"
                      variant="subtle"
                      size="xs"
                    >
                      {{ isOverdue(item.due_at) ? '已超时' : '即将到期' }}
                    </UBadge>
                  </div>
                  <span class="text-[11px] font-medium text-dimmed">
                    {{ formatClock(item.due_at || item.created_at) }}
                  </span>
                </div>

                <div>
                  <h3 class="text-base font-semibold leading-snug text-highlighted">
                    {{ item.biz_title }}
                  </h3>
                  <p class="mt-1 text-sm text-muted">
                    {{ item.node_name }} · {{ item.instance_no }}
                  </p>
                </div>

                <div class="flex items-center justify-between gap-4">
                  <div class="flex min-w-0 items-center gap-3">
                    <div class="flex size-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {{ getUserInitial(item.initiator_uid) }}
                    </div>
                    <p class="truncate text-sm font-medium text-highlighted">
                      {{ getUserName(item.initiator_uid) }}
                    </p>
                  </div>
                  <p class="shrink-0 text-xs text-muted">
                    {{ formatRelativeTime(item.created_at) }}
                  </p>
                  <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
                </div>
              </UCard>
            </div>
          </div>

          <div class="approval-board-column approval-board-column--done min-w-0 overflow-hidden rounded-xl">
            <div class="flex items-center justify-between px-3 py-2 rounded-t-lg bg-success/5">
              <div class="min-w-0">
                <span class="font-medium text-sm">已办</span>
              </div>
              <UBadge color="neutral" variant="subtle" size="xs">
                {{ doneItems.length }} / {{ doneData.total }}
              </UBadge>
            </div>
            <div class="space-y-3 p-3 bg-elevated/40 rounded-b-lg min-h-32">
              <div v-if="doneLoading" class="flex min-h-56 items-center justify-center">
                <UIcon name="i-lucide-loader-2" class="size-7 animate-spin text-dimmed" />
              </div>
              <div v-else-if="doneItems.length === 0" class="flex min-h-56 flex-col items-center justify-center text-center text-muted">
                <UIcon name="i-lucide-check-square" class="mb-3 size-10 text-dimmed" />
                <p class="text-sm font-medium text-highlighted">
                  暂无已办
                </p>
                <p class="mt-1 text-xs">
                  {{ searchQuery.trim() ? '调整搜索条件后再试' : '最近处理完成的审批会出现在这里' }}
                </p>
              </div>
              <UCard
                v-for="item in doneItems"
                :key="item.task_id"
                class="cursor-pointer overflow-hidden"
                :ui="{ body: compactMode ? 'p-3 space-y-3' : 'p-3 space-y-4' }"
                @click="navigateToApprovalDone(item)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <UBadge color="neutral" variant="subtle" size="xs">
                      {{ item.action_name || item.action_code }}
                    </UBadge>
                    <UBadge
                      v-if="item.instance_status"
                      :color="statusMap[item.instance_status]?.color || 'neutral'"
                      variant="subtle"
                      size="xs"
                    >
                      {{ statusMap[item.instance_status]?.label || item.instance_status }}
                    </UBadge>
                  </div>
                  <span class="text-[11px] font-medium text-dimmed">
                    {{ formatClock(item.completed_at || item.created_at) }}
                  </span>
                </div>

                <div>
                  <h3 class="text-base font-semibold leading-snug text-highlighted">
                    {{ item.biz_title }}
                  </h3>
                  <p class="mt-1 text-sm text-muted">
                    {{ item.node_name }} · {{ item.instance_no }}
                  </p>
                </div>

                <div class="flex items-center justify-between gap-4">
                  <div class="flex min-w-0 items-center gap-3">
                    <div class="flex size-8 items-center justify-center rounded-full bg-elevated text-xs font-semibold text-highlighted">
                      {{ getUserInitial(item.initiator_uid) }}
                    </div>
                    <p class="truncate text-sm font-medium text-highlighted">
                      {{ getUserName(item.initiator_uid) }}
                    </p>
                  </div>
                  <p class="shrink-0 text-xs text-muted">
                    {{ formatRelativeTime(item.completed_at || item.created_at) }}
                  </p>
                  <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
                </div>
              </UCard>
            </div>
          </div>

          <div class="approval-board-column approval-board-column--initiated min-w-0 overflow-hidden rounded-xl">
            <div class="flex items-center justify-between px-3 py-2 rounded-t-lg bg-secondary/5">
              <div class="min-w-0">
                <span class="font-medium text-sm">我发起的</span>
              </div>
              <UBadge color="warning" variant="subtle" size="xs">
                {{ initiatedItems.length }} / {{ initiatedData.total }}
              </UBadge>
            </div>
            <div class="space-y-3 p-3 bg-elevated/40 rounded-b-lg min-h-32">
              <div v-if="initiatedLoading" class="flex min-h-56 items-center justify-center">
                <UIcon name="i-lucide-loader-2" class="size-7 animate-spin text-warning" />
              </div>
              <div v-else-if="initiatedItems.length === 0" class="flex min-h-56 flex-col items-center justify-center text-center text-muted">
                <UIcon name="i-lucide-send" class="mb-3 size-10 text-warning/70" />
                <p class="text-sm font-medium text-highlighted">
                  暂无发起记录
                </p>
                <p class="mt-1 text-xs">
                  {{ searchQuery.trim() ? '调整搜索条件后再试' : '你主动发起的流程轨迹会沉淀在这里' }}
                </p>
              </div>
              <UCard
                v-for="item in initiatedItems"
                :key="item.instance_id"
                class="cursor-pointer overflow-hidden"
                :ui="{ body: compactMode ? 'p-3 space-y-3' : 'p-3 space-y-4' }"
                @click="navigateToInitiated(item)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <UBadge color="neutral" variant="subtle" size="xs">
                      {{ item.action_name || item.action_code }}
                    </UBadge>
                    <UBadge
                      :color="statusMap[item.status]?.color || 'neutral'"
                      variant="subtle"
                      size="xs"
                    >
                      {{ statusMap[item.status]?.label || item.status }}
                    </UBadge>
                  </div>
                  <span class="text-[11px] font-medium text-dimmed">
                    {{ formatClock(item.completed_at || item.created_at) }}
                  </span>
                </div>

                <div>
                  <h3 class="text-base font-semibold leading-snug text-highlighted">
                    {{ item.biz_title }}
                  </h3>
                  <p class="mt-1 text-sm text-muted">
                    {{ item.instance_no }} · {{ item.app_code }} · 当前第 {{ item.current_node + 1 }} 节点
                  </p>
                </div>

                <div class="flex items-center justify-between gap-4">
                  <div class="flex min-w-0 items-center gap-3">
                    <div class="flex size-8 items-center justify-center rounded-full bg-secondary/10 text-xs font-semibold text-secondary">
                      {{ getUserInitial(authUserUid) }}
                    </div>
                    <p class="truncate text-sm font-medium text-highlighted">
                      {{ getUserName(authUserUid) }}
                    </p>
                  </div>
                  <p class="shrink-0 text-xs text-muted">
                    {{ formatRelativeTime(item.created_at) }}
                  </p>
                  <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
                </div>
              </UCard>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.approval-board-column--pending {
  box-shadow:
    inset 0 2px 0 0 color-mix(in srgb, var(--ui-primary) 72%, transparent),
    0 12px 28px -22px color-mix(in srgb, var(--ui-primary) 26%, transparent);
}

.approval-board-column--done {
  box-shadow:
    inset 0 2px 0 0 color-mix(in srgb, var(--ui-success) 76%, transparent),
    0 12px 28px -22px color-mix(in srgb, var(--ui-success) 28%, transparent);
}

.approval-board-column--initiated {
  box-shadow:
    inset 0 2px 0 0 color-mix(in srgb, var(--ui-secondary) 76%, transparent),
    0 12px 28px -22px color-mix(in srgb, var(--ui-secondary) 28%, transparent);
}
</style>
