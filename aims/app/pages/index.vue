<script setup lang="ts">
import { typeConfig, priorityConfig } from '~/config/work-item'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '工作台',
  layoutHeaderProjectSwitcher: false
})

type BoardScope = 'assigned' | 'member' | 'created' | 'verify' | 'archived'
type SwimlaneMode = 'none' | 'assignee' | 'priority'

interface GlobalWorkItem {
  id: number
  projectId: number
  projectCode: string
  projectName: string
  milestoneId: number | null
  milestoneName: string | null
  itemKey: string
  tier: string
  type: string
  templateKey: string | null
  title: string
  status: string
  priority: string
  severity: string | null
  weight: number
  assigneeUid: string | null
  reporterUid: string | null
  parentId: number | null
  dueDate: string | null
  createdAt: string
  updatedAt: string
}

interface WorkspaceActivity {
  id: number
  fieldName: string
  oldValue: string | null
  newValue: string | null
  changedBy: string
  changedAt: string
  itemKey: string
  itemTitle: string
  projectName: string
}

interface WorkspaceData {
  recentActivity: WorkspaceActivity[]
  projectStats?: {
    managed: number
    participating: number
  }
}

const route = useRoute()
const router = useRouter()
const { user: authUser } = useAuth()
const { users: accountUsers } = useAccountUsers()

const loading = ref(false)
const items = ref<GlobalWorkItem[]>([])
const swimlaneMode = ref<SwimlaneMode>('none')
const searchText = ref('')
const showActivityDrawer = ref(false)

const scopeOptions: { label: string, value: BoardScope }[] = [
  { label: '我负责的', value: 'assigned' },
  { label: '我参与的', value: 'member' },
  { label: '我创建的', value: 'created' },
  { label: '待我验证', value: 'verify' },
  { label: '已归档', value: 'archived' }
]

const columns = [
  { key: 'planning', label: '规划中', color: 'neutral' },
  { key: 'todo', label: '待办', color: 'info' },
  { key: 'in_progress', label: '执行中', color: 'primary' },
  { key: 'in_review', label: '确认中', color: 'warning' },
  { key: 'completed', label: '已完成', color: 'success' }
] as const

const columnColorClass: Record<string, string> = {
  neutral: 'border-neutral-300 dark:border-neutral-600',
  primary: 'border-primary',
  info: 'border-info',
  warning: 'border-warning',
  success: 'border-success'
}

const swimlaneOptions = [
  { label: '不分组', value: 'none' },
  { label: '按指派人', value: 'assignee' },
  { label: '按优先级', value: 'priority' }
]

const workspaceQuery = computed(() => ({
  current_user: authUser.value || undefined
}))

const { data: workspace, status: workspaceStatus } = useFetch<{ code: number, data: WorkspaceData }>('/api/v1/workspace', {
  query: workspaceQuery,
  watch: [authUser]
})

const workspaceLoading = computed(() => workspaceStatus.value === 'pending')
const recentActivity = computed(() => workspace.value?.data?.recentActivity ?? [])
const managedProjectCount = computed(() => Number(workspace.value?.data?.projectStats?.managed ?? 0))
const participatingProjectCount = computed(() => Number(workspace.value?.data?.projectStats?.participating ?? 0))

const recentActivityInSevenDays = computed(() => recentActivity.value.filter(activity => isWithinLastSevenDays(activity.changedAt)))

const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const u of accountUsers.value) {
    if (u.realName?.trim()) map.set(u.uid, u.realName.trim())
  }
  return map
})

function getUserName(uid: string | null | undefined) {
  if (!uid) return '未指派'
  return userNameMap.value.get(uid) || uid
}

function isScopeValue(value: string): value is BoardScope {
  return scopeOptions.some(option => option.value === value)
}

function updateRouteQuery(partial: { filter?: BoardScope, projectId?: string }) {
  const nextQuery = { ...route.query }
  const nextFilter = partial.filter ?? activeFilter.value
  const nextProjectId = partial.projectId ?? selectedProjectId.value

  if (nextFilter === 'assigned') delete nextQuery.filter
  else nextQuery.filter = nextFilter

  if (nextProjectId === 'all') delete nextQuery.projectId
  else nextQuery.projectId = nextProjectId

  router.replace({ query: nextQuery })
}

const activeFilter = computed<BoardScope>({
  get() {
    const value = String(route.query.filter || 'assigned')
    return isScopeValue(value) ? value : 'assigned'
  },
  set(value) {
    updateRouteQuery({ filter: value })
  }
})

const selectedProjectId = computed<string>({
  get() {
    const value = String(route.query.projectId || 'all')
    return value || 'all'
  },
  set(value) {
    updateRouteQuery({ projectId: value })
  }
})

const projectOptions = computed(() => {
  const projectMap = new Map<number, { label: string, value: string }>()
  for (const item of items.value) {
    if (!projectMap.has(item.projectId)) {
      projectMap.set(item.projectId, {
        label: `${item.projectCode} · ${item.projectName}`,
        value: String(item.projectId)
      })
    }
  }

  return [
    { label: '全部项目', value: 'all' },
    ...Array.from(projectMap.entries())
      .sort((a, b) => a[1].label.localeCompare(b[1].label, 'zh-CN'))
      .map(([, option]) => option)
  ]
})

const filteredItems = computed(() => {
  const keyword = searchText.value.trim().toLowerCase()
  return items.value.filter((item) => {
    if (selectedProjectId.value !== 'all' && String(item.projectId) !== selectedProjectId.value) {
      return false
    }
    if (!keyword) return true
    return [
      item.itemKey,
      item.title,
      item.projectName,
      item.projectCode,
      item.milestoneName || '',
      getUserName(item.assigneeUid)
    ].some(field => field.toLowerCase().includes(keyword))
  })
})

const totalCount = computed(() => filteredItems.value.length)

const statusSummary = computed(() => ({
  planning: filteredItems.value.filter(item => item.status === 'planning').length,
  todo: filteredItems.value.filter(item => item.status === 'todo').length,
  inProgress: filteredItems.value.filter(item => item.status === 'in_progress').length,
  inReview: filteredItems.value.filter(item => item.status === 'in_review').length,
  completed: filteredItems.value.filter(item => item.status === 'completed').length,
  overdue: filteredItems.value.filter(item => item.status !== 'completed' && isOverdue(item.dueDate)).length
}))

const boardData = computed(() => {
  const data: Record<string, GlobalWorkItem[]> = {}
  for (const col of columns) {
    data[col.key] = filteredItems.value.filter(item => item.status === col.key)
  }
  return data
})

const swimlanes = computed(() => {
  if (swimlaneMode.value === 'none') return null
  const groups = new Map<string, string>()

  for (const item of filteredItems.value) {
    if (swimlaneMode.value === 'assignee') {
      const key = item.assigneeUid || '__unassigned__'
      if (!groups.has(key)) groups.set(key, getUserName(item.assigneeUid))
    } else if (swimlaneMode.value === 'priority') {
      if (!groups.has(item.priority)) groups.set(item.priority, item.priority)
    }
  }

  const ordered = Array.from(groups.entries()).map(([key, label]) => ({ key, label }))
  if (swimlaneMode.value === 'priority') {
    const order = ['P0', 'P1', 'P2', 'P3']
    ordered.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  }
  return ordered
})

function getColumnItems(colKey: string) {
  return boardData.value[colKey] || []
}

function getSwimlaneColumnItems(colKey: string, swimlaneKey: string) {
  const items = getColumnItems(colKey)
  if (swimlaneMode.value === 'assignee') {
    if (swimlaneKey === '__unassigned__') return items.filter(item => !item.assigneeUid)
    return items.filter(item => item.assigneeUid === swimlaneKey)
  }
  if (swimlaneMode.value === 'priority') {
    return items.filter(item => item.priority === swimlaneKey)
  }
  return items
}

function parseDateTime(dateStr: string) {
  return new Date(dateStr.replace(' ', 'T'))
}

function isWithinLastSevenDays(dateStr: string) {
  const date = parseDateTime(dateStr)
  const diffMs = Date.now() - date.getTime()
  return Number.isFinite(diffMs) && diffMs >= 0 && diffMs <= 7 * 24 * 60 * 60 * 1000
}

function isOverdue(dueDate: string | null) {
  if (!dueDate) return false
  return new Date(dueDate) < new Date(new Date().toDateString())
}

function formatDueDate(dueDate: string | null) {
  if (!dueDate) return '未设截止'
  return dueDate.slice(5, 10)
}

const fieldLabel: Record<string, string> = {
  status: '状态',
  priority: '优先级',
  assignee: '负责人',
  assignee_uid: '负责人',
  title: '标题',
  description: '描述',
  dueDate: '截止日期',
  due_date: '截止日期'
}

const valueLabel: Record<string, string> = {
  planning: '规划中',
  todo: '待办',
  in_progress: '执行中',
  in_review: '确认中',
  testing: '测试中',
  completed: '已完成',
  done: '已完成',
  P0: '紧急',
  P1: '高',
  P2: '中',
  P3: '低'
}

function formatActivity(a: WorkspaceActivity): string {
  if (a.fieldName === 'work_item_updated') {
    return '工作项有更新'
  }

  const field = fieldLabel[a.fieldName] || a.fieldName
  const oldVal = valueLabel[a.oldValue || ''] || a.oldValue || '空'
  const newVal = valueLabel[a.newValue || ''] || a.newValue || '空'
  return `将 ${a.itemKey} 的${field}从 ${oldVal} 改为 ${newVal}`
}

function formatActivityActor(a: WorkspaceActivity): string {
  if (a.fieldName === 'work_item_updated') {
    return ''
  }
  return a.changedBy ? `${a.changedBy} ` : ''
}

function formatTimeAgo(dateStr: string): string {
  const date = parseDateTime(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay} 天前`
  return date.toLocaleDateString('zh-CN')
}

function openItem(item: GlobalWorkItem) {
  if (['in_progress', 'in_review', 'completed'].includes(item.status)) {
    navigateTo(`/projects/${item.projectId}/board/${item.id}/execution`)
    return
  }
  navigateTo(`/projects/${item.projectId}/board`)
}

async function loadItems() {
  if (!authUser.value) return
  loading.value = true
  try {
    const params = new URLSearchParams()
    params.set('filter', activeFilter.value)
    params.set('uid', authUser.value)

    const res = await $fetch<{ code: number, data: { items: GlobalWorkItem[] } }>(
      `/api/v1/my-work-items?${params.toString()}`
    )
    items.value = res.code === 0 ? res.data.items : []
  } catch (err) {
    console.error('[WorkspaceBoard] loadItems failed:', err)
    items.value = []
  } finally {
    loading.value = false
  }
}

if (import.meta.client) {
  watch([activeFilter, authUser], () => {
    loadItems()
  }, { immediate: true })
}
</script>

<template>
  <UDashboardPanel id="workspace-board" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex flex-col h-full min-h-0">
        <div class="flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-8 space-y-5">
          <div class="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
            <UCard class="p-0">
              <div class="px-4 py-3">
                <div class="text-xs text-muted">
                  管理/参与项目
                </div>
                <div class="mt-1 text-2xl font-semibold text-secondary">
                  {{ managedProjectCount }} / {{ participatingProjectCount }} 个
                </div>
              </div>
            </UCard>
            <UCard class="p-0">
              <div class="px-4 py-3">
                <div class="text-xs text-muted">
                  已完成/全部任务
                </div>
                <div class="mt-1 text-2xl font-semibold">
                  {{ statusSummary.completed }} / {{ totalCount }}
                </div>
              </div>
            </UCard>
            <UCard class="p-0">
              <div class="px-4 py-3">
                <div class="text-xs text-muted">
                  逾期
                </div>
                <div class="mt-1 text-2xl font-semibold text-error">
                  {{ statusSummary.overdue }}
                </div>
              </div>
            </UCard>
            <UCard
              class="p-0 cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md"
              role="button"
              tabindex="0"
              @click="showActivityDrawer = true"
              @keydown.enter="showActivityDrawer = true"
            >
              <div class="px-4 py-3">
                <div class="flex items-center justify-between gap-2 text-xs text-muted">
                  <span>最近动态</span>
                  <UIcon name="i-lucide-panel-right-open" class="size-3.5" />
                </div>
                <div class="mt-1 text-2xl font-semibold text-primary">
                  {{ recentActivityInSevenDays.length }}
                </div>
              </div>
            </UCard>
          </div>

          <section class="flex flex-col gap-3 rounded-2xl border border-default bg-default p-4">
            <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-sm text-muted">视角</span>
                <UButton
                  v-for="option in scopeOptions"
                  :key="option.value"
                  :label="option.label"
                  size="sm"
                  :color="activeFilter === option.value ? 'primary' : 'neutral'"
                  :variant="activeFilter === option.value ? 'soft' : 'ghost'"
                  @click="activeFilter = option.value"
                />
              </div>
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                <UInput
                  v-model="searchText"
                  icon="i-lucide-search"
                  placeholder="搜索编号、标题、项目、负责人"
                  class="w-full sm:w-60"
                />
                <USelect
                  v-model="selectedProjectId"
                  :items="projectOptions"
                  class="w-full sm:w-40"
                />
                <USelect
                  v-model="swimlaneMode"
                  :items="swimlaneOptions"
                  class="w-full sm:w-36"
                />
              </div>
            </div>
          </section>

          <div v-if="loading" class="flex justify-center py-12">
            <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-muted" />
          </div>

          <div v-else-if="filteredItems.length === 0" class="rounded-2xl border border-dashed border-default bg-elevated/30 py-16 text-center text-muted">
            <UIcon name="i-lucide-kanban" class="mx-auto mb-3 size-10" />
            <p class="text-sm">
              当前筛选条件下暂无任务
            </p>
          </div>

          <div v-else-if="!swimlanes" class="flex gap-4 overflow-x-auto pb-4">
            <div
              v-for="col in columns"
              :key="col.key"
              class="shrink-0 w-48 xl:w-11/60"
            >
              <div class="flex items-center justify-between rounded-t-xl border-t-2 border-x border-b-0 px-4 py-3" :class="columnColorClass[col.color]">
                <div class="text-sm font-medium">
                  {{ col.label }}
                </div>
                <div class="text-xs text-muted">
                  {{ getColumnItems(col.key).length }} 项
                </div>
              </div>
              <div class="min-h-40 space-y-3 rounded-b-xl border border-default bg-elevated/50 p-3">
                <button
                  v-for="item in getColumnItems(col.key)"
                  :key="item.id"
                  type="button"
                  class="w-full rounded-xl border border-default bg-default p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  :class="isOverdue(item.dueDate) ? 'ring-1 ring-error/30' : ''"
                  @click="openItem(item)"
                >
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <div class="flex min-w-0 items-center gap-2">
                      <UIcon
                        :name="typeConfig[item.type as keyof typeof typeConfig]?.icon || 'i-lucide-circle'"
                        :class="['size-3.5 shrink-0', typeConfig[item.type as keyof typeof typeConfig]?.color || '']"
                      />
                      <span class="truncate font-mono text-xs text-muted">{{ item.itemKey }}</span>
                    </div>
                    <UBadge :color="(priorityConfig[item.priority as keyof typeof priorityConfig]?.color as any)" variant="subtle" size="xs">
                      {{ item.priority }}
                    </UBadge>
                  </div>

                  <div class="line-clamp-2 text-sm font-medium">
                    {{ item.title }}
                  </div>

                  <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <UBadge color="neutral" variant="soft" size="xs">
                      {{ item.projectCode }}
                    </UBadge>
                    <span class="truncate max-w-45">{{ item.projectName }}</span>
                  </div>

                  <div class="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
                    <span class="truncate">{{ getUserName(item.assigneeUid) }}</span>
                    <span :class="isOverdue(item.dueDate) ? 'font-medium text-error' : ''">
                      {{ formatDueDate(item.dueDate) }}
                    </span>
                  </div>
                </button>

                <div v-if="getColumnItems(col.key).length === 0" class="py-10 text-center text-xs text-muted">
                  暂无任务
                </div>
              </div>
            </div>
          </div>

          <div v-else class="space-y-6 overflow-x-auto pb-4">
            <section
              v-for="lane in swimlanes"
              :key="lane.key"
              class="overflow-hidden rounded-2xl border border-default bg-default"
            >
              <div class="flex items-center gap-2 border-b border-default bg-elevated/50 px-4 py-3 text-sm font-medium">
                <UIcon :name="swimlaneMode === 'assignee' ? 'i-lucide-user' : 'i-lucide-signal'" class="size-4" />
                {{ lane.label }}
                <UBadge color="neutral" variant="subtle" size="xs">
                  {{ columns.reduce((sum, col) => sum + getSwimlaneColumnItems(col.key, lane.key).length, 0) }}
                </UBadge>
              </div>
              <div class="flex gap-4 overflow-x-auto p-4">
                <div
                  v-for="col in columns"
                  :key="col.key"
                  class="shrink-0 w-56"
                >
                  <div class="mb-2 flex items-center justify-between px-1 text-xs text-muted">
                    <span>{{ col.label }}</span>
                    <span>{{ getSwimlaneColumnItems(col.key, lane.key).length }}</span>
                  </div>
                  <div class="space-y-2">
                    <button
                      v-for="item in getSwimlaneColumnItems(col.key, lane.key)"
                      :key="item.id"
                      type="button"
                      class="w-full rounded-lg border border-default bg-elevated/40 p-3 text-left transition hover:bg-elevated"
                      @click="openItem(item)"
                    >
                      <div class="mb-1 flex items-center justify-between gap-2">
                        <span class="truncate font-mono text-[11px] text-muted">{{ item.itemKey }}</span>
                        <UBadge :color="(priorityConfig[item.priority as keyof typeof priorityConfig]?.color as any)" variant="subtle" size="xs">
                          {{ item.priority }}
                        </UBadge>
                      </div>
                      <div class="line-clamp-2 text-sm font-medium">
                        {{ item.title }}
                      </div>
                      <div class="mt-2 truncate text-[11px] text-muted">
                        {{ item.projectCode }} · {{ item.projectName }}
                      </div>
                    </button>
                    <div v-if="getSwimlaneColumnItems(col.key, lane.key).length === 0" class="py-4 text-center text-xs text-muted">
                      -
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <USlideover v-model:open="showActivityDrawer" title="最近动态" :ui="{ content: 'sm:max-w-xl' }">
    <template #body>
      <div v-if="workspaceLoading" class="flex justify-center py-12">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
      </div>
      <div v-else-if="recentActivityInSevenDays.length === 0" class="py-12 text-center text-sm text-muted">
        近 7 日暂无动态
      </div>
      <div v-else class="space-y-3 p-1">
        <div
          v-for="activity in recentActivityInSevenDays"
          :key="activity.id"
          class="rounded-xl border border-default bg-default p-3"
        >
          <div class="flex items-start gap-3">
            <UIcon name="i-lucide-activity" class="mt-0.5 size-4 shrink-0 text-primary" />
            <div class="min-w-0 flex-1">
              <div class="text-sm">
                {{ formatActivityActor(activity) }}{{ formatActivity(activity) }}
              </div>
              <div class="mt-1 text-xs text-muted">
                <span class="font-mono">{{ activity.itemKey }}</span>
                <span class="mx-1">{{ activity.itemTitle }}</span>
              </div>
              <div class="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
                <span class="truncate">{{ activity.projectName }}</span>
                <span class="shrink-0">{{ formatTimeAgo(activity.changedAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </USlideover>
</template>
