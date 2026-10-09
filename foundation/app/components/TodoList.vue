<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import ContentPageHeader from './ContentPageHeader.vue'

const props = withDefaults(defineProps<{
  apiPath: string
  serverPagination?: boolean
  hosted?: boolean
  panelUi?: { root?: string, body?: string }
}>(), { hosted: false, serverPagination: false, panelUi: () => ({}) })
const todoColumns: TableColumn<PendingTodo>[] = [
  { accessorKey: 'displayLabel', header: '待办事项' },
  { accessorKey: 'sourceAppCode', header: '来源应用' },
  { accessorKey: 'todoKind', header: '类型' },
  { accessorKey: 'updatedAt', header: '更新时间' }
]
type TodoKind = 'approval' | 'due' | 'risk' | 'follow_up'
type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'
interface PendingTodo {
  notificationId: string
  sourceAppCode: string
  targetAppCode: string
  todoKind: TodoKind
  category: string
  severity: NotificationSeverity
  displayLabel: string
  createdAt: string
  updatedAt: string
}

usePageTitle('我的待办')

const { apps, loadApps } = useUserApplications()
const { loadDetail, markRead, cacheFingerprint } = useNotifications()
const route = useRoute()
const toast = useToast()
const items = ref<PendingTodo[]>([])
const loading = ref(false)
const error = ref('')
const nextCursor = ref<string | null>(null)
const selectedKind = ref<TodoKind | 'all'>('all')
const openingId = ref('')
const total = ref(0)
const kindCounts = ref<Record<string, number>>({})
const { page, pageSize } = useListPage({ pageSize: 20, filters: props.serverPagination ? { todoKind: selectedKind } : {}, syncUrl: props.serverPagination })
let generation = 0, openGeneration = 0
let controller: AbortController | undefined
let mounted = false
function invalidate() {
  generation++
  openGeneration++
  controller?.abort()
  items.value = []
  total.value = 0
  kindCounts.value = {}
  nextCursor.value = null
  loading.value = false
  openingId.value = ''
  error.value = ''
}
watch(cacheFingerprint, () => {
  invalidate()
  if (mounted && cacheFingerprint.value) void loadTodos()
}, { flush: 'sync' })
watch(() => `${page.value}/${selectedKind.value}`, () => {
  if (mounted && props.serverPagination) void loadTodos()
})
onScopeDispose(invalidate)

const filters: Array<{ label: string, value: TodoKind | 'all' }> = [
  { label: '全部', value: 'all' },
  { label: '审批', value: 'approval' },
  { label: '临期', value: 'due' },
  { label: '风险', value: 'risk' },
  { label: '跟进', value: 'follow_up' }
]

const kindLabel: Record<TodoKind, string> = {
  approval: '审批',
  due: '临期',
  risk: '风险',
  follow_up: '跟进'
}

const severityColor: Record<NotificationSeverity, 'info' | 'success' | 'warning' | 'error'> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error'
}

async function loadTodos(append = false) {
  if (!props.serverPagination && loading.value) return
  const epoch = ++generation, fingerprint = cacheFingerprint.value, requestedPage = page.value, requestedKind = selectedKind.value
  controller?.abort()
  controller = new AbortController()
  if (!fingerprint) {
    invalidate()
    return
  }
  if (props.serverPagination) {
    items.value = []
    total.value = 0
  }
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<{ data: { items: PendingTodo[], nextCursor: string | null, total: number, page: number, pageSize: number, kindCounts: Record<string, number> } }>(
      props.apiPath,
      {
        signal: controller.signal,
        query: {
          todoKind: selectedKind.value === 'all' ? undefined : selectedKind.value,
          ...(props.serverPagination ? { page: page.value, pageSize } : { cursor: append ? nextCursor.value || undefined : undefined, limit: 20 })
        }
      }
    )
    if (epoch !== generation || fingerprint !== cacheFingerprint.value || requestedPage !== page.value || requestedKind !== selectedKind.value) return
    if (props.serverPagination) {
      const data = response.data
      if (!data || !Array.isArray(data.items) || data.items.length > pageSize || !Number.isSafeInteger(data.total) || data.total < 0 || data.page !== page.value || data.pageSize !== pageSize || !data.kindCounts
        || ['approval', 'due', 'risk', 'follow_up'].some(kind => !Number.isSafeInteger(data.kindCounts[kind]) || Number(data.kindCounts[kind]) < 0)) throw new Error('Invalid todo page')
      total.value = data.total
      kindCounts.value = data.kindCounts
      if (page.value > 1 && !data.items.length && data.total < (page.value - 1) * pageSize + 1) {
        page.value = Math.max(1, Math.ceil(data.total / pageSize))
        return
      }
    }
    const payload = response.data || { items: [], nextCursor: null }
    items.value = append ? [...items.value, ...payload.items] : payload.items
    nextCursor.value = payload.nextCursor ?? null
  } catch {
    if (epoch !== generation || fingerprint !== cacheFingerprint.value || requestedPage !== page.value || requestedKind !== selectedKind.value) return
    if (!append) items.value = []
    error.value = '待办加载失败，请稍后重试。'
  } finally {
    if (epoch === generation) loading.value = false
  }
}

async function selectKind(kind: TodoKind | 'all') {
  selectedKind.value = kind
  nextCursor.value = null
  if (props.serverPagination) page.value = 1
  else await loadTodos()
}

async function openTodo(item: PendingTodo) {
  if (openingId.value || !cacheFingerprint.value) return
  const epoch = ++openGeneration, fingerprint = cacheFingerprint.value
  openingId.value = item.notificationId
  try {
    const detail = await loadDetail(item.notificationId)
    if (epoch !== openGeneration || fingerprint !== cacheFingerprint.value) return
    const actionUrl = resolveNotificationActionUrl(detail, apps.value, window.location.origin, hostNotificationTarget())
    if (!actionUrl) throw new Error('notification_action_url_invalid')
    await markRead(item.notificationId)
    if (epoch !== openGeneration || fingerprint !== cacheFingerprint.value) return
    await navigateTo(actionUrl, { external: /^https?:\/\//i.test(actionUrl) })
  } catch (cause) {
    if (epoch !== openGeneration || fingerprint !== cacheFingerprint.value) return
    const statusCode = Number((cause as { statusCode?: number, status?: number })?.statusCode
      || (cause as { status?: number })?.status
      || 0)
    toast.add({
      title: statusCode === 403 ? '当前无权处理该待办' : '待办详情暂时不可用',
      description: statusCode === 403 ? '您的业务对象权限可能已发生变化。' : '来源应用未能完成实时授权，请稍后重试。',
      color: statusCode === 403 ? 'warning' : 'error'
    })
  } finally {
    if (epoch === openGeneration) openingId.value = ''
  }
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

onMounted(async () => {
  mounted = true
  if (!props.serverPagination) {
    const requestedKind = String(Array.isArray(route.query.todoKind) ? route.query.todoKind[0] : route.query.todoKind || '')
    if (['approval', 'due', 'risk', 'follow_up'].includes(requestedKind)) selectedKind.value = requestedKind as TodoKind
  }
  await Promise.all([loadApps(), loadTodos()])
})
</script>

<template>
  <UDashboardPanel id="todos" :ui="panelUi">
    <template v-if="!hosted" #header>
      <UDashboardNavbar title="我的待办" />
    </template>

    <template #body>
      <div class="flex min-w-0 w-full flex-col gap-4">
        <ContentPageHeader
          v-if="hosted"
          title="我的待办"
          :hosted="true"
          description="查看需要处理的个人事项。"
        />
        <div class="flex flex-wrap gap-2" aria-label="待办类型筛选">
          <UButton
            v-for="filter in filters"
            :key="filter.value"
            :label="serverPagination && kindCounts[filter.value] !== undefined ? `${filter.label} ${kindCounts[filter.value]}` : filter.label"
            color="neutral"
            :variant="selectedKind === filter.value ? 'solid' : 'outline'"
            size="sm"
            @click="selectKind(filter.value)"
          />
        </div>

        <UCard v-if="error && !items.length">
          <div class="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
            <UIcon name="i-lucide-circle-alert" class="size-8 text-error" />
            <p class="text-sm text-muted">
              {{ error }}
            </p>
            <UButton
              label="重新加载"
              color="neutral"
              variant="outline"
              @click="loadTodos()"
            />
          </div>
        </UCard>

        <div v-else class="space-y-4">
          <UTable
            :data="items"
            :columns="todoColumns"
            :loading="loading && !items.length"
            class="rounded-lg border border-default"
          >
            <template #displayLabel-cell="{ row }">
              <UButton
                variant="link"
                color="neutral"
                class="max-w-96 truncate text-left font-medium"
                :label="row.original.displayLabel"
                :disabled="Boolean(openingId)"
                :loading="openingId === row.original.notificationId"
                @click="openTodo(row.original)"
              />
            </template>
            <template #sourceAppCode-cell="{ row }">
              <UBadge color="neutral" variant="subtle">
                {{ row.original.sourceAppCode }}
              </UBadge>
            </template>
            <template #todoKind-cell="{ row }">
              <UBadge :color="severityColor[row.original.severity]" variant="subtle">
                {{ kindLabel[row.original.todoKind] }}
              </UBadge>
            </template>
            <template #updatedAt-cell="{ row }">
              <span class="text-xs text-muted">{{ formatTime(row.original.updatedAt) }}</span>
            </template>
            <template #empty>
              <CommonEmptyState icon="i-lucide-clipboard-check" title="当前没有待处理事项" description="已读和归档不会影响待办状态，事项会在来源业务完成后关闭。" />
            </template>
          </UTable>
          <div v-if="serverPagination" class="flex flex-wrap items-center justify-between gap-3">
            <span class="text-sm text-muted">共 {{ total }} 条</span>
            <UPagination
              v-model:page="page"
              :total="total"
              :items-per-page="pageSize"
              :disabled="loading"
            />
          </div>
          <p v-else class="text-sm text-muted">
            已加载 {{ items.length }} 条<span v-if="nextCursor">，还有更多</span>
          </p>

          <div v-if="error" class="flex items-center justify-between rounded-md border border-error/30 bg-error/5 p-3">
            <p class="text-sm text-error">
              {{ error }}
            </p>
            <UButton
              label="重试"
              size="sm"
              color="error"
              variant="ghost"
              @click="loadTodos(Boolean(nextCursor))"
            />
          </div>

          <UButton
            v-if="!serverPagination && nextCursor"
            block
            label="加载更多"
            color="neutral"
            variant="outline"
            :loading="loading"
            @click="loadTodos(true)"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
