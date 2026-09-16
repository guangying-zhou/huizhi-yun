<script setup lang="ts">
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
const { loadDetail, markRead } = useNotifications()
const route = useRoute()
const toast = useToast()
const items = ref<PendingTodo[]>([])
const loading = ref(false)
const error = ref('')
const nextCursor = ref<string | null>(null)
const selectedKind = ref<TodoKind | 'all'>('all')
const openingId = ref('')

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
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<{ data: { items: PendingTodo[], nextCursor: string | null } }>(
      '/api/v1/console/notifications/todos',
      {
        query: {
          todoKind: selectedKind.value === 'all' ? undefined : selectedKind.value,
          cursor: append ? nextCursor.value || undefined : undefined,
          limit: 20
        }
      }
    )
    const payload = response.data || { items: [], nextCursor: null }
    items.value = append ? [...items.value, ...payload.items] : payload.items
    nextCursor.value = payload.nextCursor
  } catch {
    if (!append) items.value = []
    error.value = '待办加载失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}

async function selectKind(kind: TodoKind | 'all') {
  selectedKind.value = kind
  nextCursor.value = null
  await loadTodos()
}

async function openTodo(item: PendingTodo) {
  if (openingId.value) return
  openingId.value = item.notificationId
  try {
    const detail = await loadDetail(item.notificationId)
    const actionUrl = resolveNotificationActionUrl(detail, apps.value, window.location.origin)
    if (!actionUrl) throw new Error('notification_action_url_invalid')
    await markRead(item.notificationId)
    await navigateTo(actionUrl, { external: /^https?:\/\//i.test(actionUrl) })
  } catch (cause) {
    const statusCode = Number((cause as { statusCode?: number, status?: number })?.statusCode
      || (cause as { status?: number })?.status
      || 0)
    toast.add({
      title: statusCode === 403 ? '当前无权处理该待办' : '待办详情暂时不可用',
      description: statusCode === 403 ? '您的业务对象权限可能已发生变化。' : '来源应用未能完成实时授权，请稍后重试。',
      color: statusCode === 403 ? 'warning' : 'error'
    })
  } finally {
    openingId.value = ''
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
  const requestedKind = String(Array.isArray(route.query.todoKind) ? route.query.todoKind[0] : route.query.todoKind || '')
  if (['approval', 'due', 'risk', 'follow_up'].includes(requestedKind)) selectedKind.value = requestedKind as TodoKind
  await Promise.all([loadApps(), loadTodos()])
})
</script>

<template>
  <UDashboardPanel id="todos">
    <template #header>
      <UDashboardNavbar title="我的待办" />
    </template>

    <template #body>
      <div class="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div class="flex flex-wrap gap-2" aria-label="待办类型筛选">
          <UButton
            v-for="filter in filters"
            :key="filter.value"
            :label="filter.label"
            color="neutral"
            :variant="selectedKind === filter.value ? 'solid' : 'outline'"
            size="sm"
            @click="selectKind(filter.value)"
          />
        </div>

        <div v-if="loading && !items.length" class="flex min-h-56 items-center justify-center">
          <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-dimmed" />
        </div>

        <UCard v-else-if="error && !items.length">
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

        <UCard v-else-if="!items.length">
          <div class="flex min-h-40 flex-col items-center justify-center gap-2 text-center">
            <UIcon name="i-lucide-clipboard-check" class="size-9 text-dimmed" />
            <p class="text-sm font-medium">
              当前没有待处理事项
            </p>
            <p class="text-xs text-muted">
              已读和归档不会影响待办状态，事项会在来源业务完成后关闭。
            </p>
          </div>
        </UCard>

        <div v-else class="space-y-3">
          <button
            v-for="item in items"
            :key="item.notificationId"
            type="button"
            class="flex w-full items-center gap-4 rounded-lg border border-default bg-default p-4 text-left transition-colors hover:bg-elevated disabled:cursor-wait disabled:opacity-70"
            :disabled="Boolean(openingId)"
            @click="openTodo(item)"
          >
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-elevated">
              <UIcon
                :name="openingId === item.notificationId ? 'i-lucide-loader-2' : 'i-lucide-clipboard-list'"
                class="size-5"
                :class="openingId === item.notificationId ? 'animate-spin text-dimmed' : 'text-muted'"
              />
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-highlighted">
                {{ item.displayLabel }}
              </p>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <UBadge color="neutral" variant="soft">
                  {{ item.sourceAppCode }}
                </UBadge>
                <UBadge :color="severityColor[item.severity]" variant="soft">
                  {{ kindLabel[item.todoKind] }}
                </UBadge>
              </div>
            </div>
            <span class="shrink-0 text-xs text-dimmed">{{ formatTime(item.updatedAt) }}</span>
            <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
          </button>

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
            v-if="nextCursor"
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
