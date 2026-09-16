<script setup lang="ts">
import type { WorkItem } from '~/types/aims'
import { typeConfig, getStatusLabel, getStatusColor } from '~/config/work-item'
import { projectModuleEnabled } from '~/utils/projectModuleConfig'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '工单',
  layoutHeaderProjectSwitcher: true
})

interface TimeEntry {
  workItemId?: number | null
  hours?: number
}

const route = useRoute()
const projectStore = useProjectStore()
const projectId = computed(() => Number(route.params.id))

const project = computed(() => projectStore.currentProject)
const moduleEnabled = computed(() =>
  projectModuleEnabled(project.value?.moduleConfig, project.value?.category, 'service_desk')
)

const loading = ref(false)
const serviceItems = ref<WorkItem[]>([])
const timeEntries = ref<TimeEntry[]>([])
const filters = reactive({
  search: '',
  type: '',
  customerCode: '',
  environmentCode: ''
})

const typeOptions = [
  { label: '全部类型', value: '' },
  { label: '任务', value: 'task' },
  { label: '缺陷', value: 'bug' },
  { label: '需求', value: 'requirement' },
  { label: '变更', value: 'change_request' }
]

function currentMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return {
    start,
    end,
    startText: start.toISOString().slice(0, 10),
    endText: end.toISOString().slice(0, 10)
  }
}

function itemPeriodDate(item: WorkItem) {
  return item.resolutionDueAt || item.responseDueAt || item.dueDate || item.updatedAt
}

function parseDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

const periodRange = computed(currentMonthRange)
const currentPeriodItems = computed(() => {
  const { start, end } = periodRange.value
  return serviceItems.value.filter((item) => {
    const date = parseDate(itemPeriodDate(item))
    if (!date) return true
    return date >= start && date <= end
  })
})

const currentPeriodItemIds = computed(() => new Set(currentPeriodItems.value.map(item => item.id)))
const currentPeriodHours = computed(() =>
  timeEntries.value
    .filter(entry => entry.workItemId && currentPeriodItemIds.value.has(entry.workItemId))
    .reduce((sum, entry) => sum + Number(entry.hours || 0), 0)
)
const periodStats = computed(() => {
  const items = currentPeriodItems.value
  const carriedOver = serviceItems.value.filter((item) => {
    if (item.status === 'completed') return false
    const date = parseDate(itemPeriodDate(item))
    return Boolean(date && date < periodRange.value.start)
  }).length
  return {
    ticketCount: items.length,
    completedCount: items.filter(item => item.status === 'completed').length,
    carriedOver,
    hours: currentPeriodHours.value
  }
})

function slaSnapshotText(item: WorkItem) {
  return item.slaStatusSnapshot || '待同步'
}

function slaSnapshotColor(item: WorkItem) {
  const snapshot = String(item.slaStatusSnapshot || '').toLowerCase()
  if (!snapshot) return 'neutral'
  if (snapshot.includes('overdue') || snapshot.includes('breach') || snapshot.includes('timeout') || snapshot.includes('逾期')) return 'error'
  if (snapshot.includes('risk') || snapshot.includes('warning') || snapshot.includes('临近')) return 'warning'
  return 'success'
}

function dueState(value: string | null | undefined) {
  const due = parseDate(value)
  if (!due) return { label: '待同步', color: 'neutral' as const }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  due.setHours(0, 0, 0, 0)
  const diff = Math.ceil((due.getTime() - today.getTime()) / 86400000)
  if (diff < 0) return { label: `逾期 ${Math.abs(diff)} 天`, color: 'error' as const }
  if (diff === 0) return { label: '今日到期', color: 'warning' as const }
  if (diff <= 2) return { label: `${diff} 天后到期`, color: 'warning' as const }
  return { label: `${diff} 天后到期`, color: 'neutral' as const }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '待同步'
  return value.replace('T', ' ').slice(0, 16)
}

function openWorkItem(item: WorkItem) {
  const routeName = item.type === 'requirement'
    ? `/projects/${projectId.value}/requirements?workItemId=${item.id}`
    : `/projects/${projectId.value}/work-items/${item.id}/breakdown`
  navigateTo(routeName)
}

async function fetchServiceDesk() {
  if (!projectId.value || !moduleEnabled.value) return
  loading.value = true
  try {
    const params: Record<string, string | number> = {
      serviceDesk: 1,
      pageSize: 100
    }
    if (filters.search.trim()) params.search = filters.search.trim()
    if (filters.type) params.type = filters.type
    if (filters.customerCode.trim()) params.customerCode = filters.customerCode.trim()
    if (filters.environmentCode.trim()) params.environmentCode = filters.environmentCode.trim()

    const [workItemsRes, timeEntriesRes] = await Promise.all([
      $fetch<{ code: number, data: { items: WorkItem[] } }>(`/api/v1/projects/${projectId.value}/work-items`, { params }),
      $fetch<{ code: number, data: { items: TimeEntry[] } }>(`/api/v1/projects/${projectId.value}/time-entries`, {
        params: {
          startDate: periodRange.value.startText,
          endDate: periodRange.value.endText
        }
      })
    ])
    serviceItems.value = workItemsRes.code === 0 ? workItemsRes.data.items : []
    timeEntries.value = timeEntriesRes.code === 0 ? timeEntriesRes.data.items : []
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!projectStore.currentProject || projectStore.currentProject.id !== projectId.value) {
    await projectStore.fetchProject(projectId.value)
  }
  await fetchServiceDesk()
})
</script>

<template>
  <UDashboardPanel id="project-service-desk" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex flex-col h-full min-h-0">
        <ProjectNavbar />

        <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          <div
            v-if="projectStore.loading && !project"
            class="flex justify-center py-12"
          >
            <UIcon
              name="i-lucide-loader-2"
              class="size-6 animate-spin text-muted"
            />
          </div>

          <ProjectModuleDisabledState
            v-else-if="!moduleEnabled"
            title="工单模块未启用"
          />

          <template v-else>
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div class="rounded-lg border border-default p-3">
                <div class="text-xs text-muted">
                  本期工单
                </div>
                <div class="text-2xl font-semibold mt-1">
                  {{ periodStats.ticketCount }}
                </div>
              </div>
              <div class="rounded-lg border border-default p-3">
                <div class="text-xs text-muted">
                  已完成
                </div>
                <div class="text-2xl font-semibold mt-1">
                  {{ periodStats.completedCount }}
                </div>
              </div>
              <div class="rounded-lg border border-default p-3">
                <div class="text-xs text-muted">
                  结转
                </div>
                <div class="text-2xl font-semibold mt-1">
                  {{ periodStats.carriedOver }}
                </div>
              </div>
              <div class="rounded-lg border border-default p-3">
                <div class="text-xs text-muted">
                  工时
                </div>
                <div class="text-2xl font-semibold mt-1">
                  {{ periodStats.hours.toFixed(1) }}
                </div>
              </div>
            </div>

            <div class="flex flex-col xl:flex-row gap-2">
              <UInput
                v-model="filters.search"
                icon="i-lucide-search"
                placeholder="工单号、标题"
                class="xl:w-72"
                @keydown.enter="fetchServiceDesk"
              />
              <USelect
                v-model="filters.type"
                :items="typeOptions"
                class="xl:w-36"
              />
              <UInput
                v-model="filters.customerCode"
                icon="i-lucide-building-2"
                placeholder="客户编码"
                class="xl:w-44"
                @keydown.enter="fetchServiceDesk"
              />
              <UInput
                v-model="filters.environmentCode"
                icon="i-lucide-server"
                placeholder="环境编码"
                class="xl:w-44"
                @keydown.enter="fetchServiceDesk"
              />
              <UButton
                icon="i-lucide-filter"
                label="筛选"
                color="primary"
                :loading="loading"
                @click="fetchServiceDesk"
              />
            </div>

            <div
              v-if="loading"
              class="flex justify-center py-12"
            >
              <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
            </div>

            <CommonEmptyState
              v-else-if="serviceItems.length === 0"
              icon="i-lucide-headset"
              title="暂无工单"
              description="当前筛选条件下没有服务工单。"
            />

            <div v-else class="divide-y divide-default rounded-lg border border-default overflow-hidden">
              <button
                v-for="item in serviceItems"
                :key="item.id"
                type="button"
                class="w-full text-left p-3 hover:bg-elevated transition-colors"
                @click="openWorkItem(item)"
              >
                <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div class="min-w-0 space-y-2">
                    <div class="flex items-center gap-2 min-w-0">
                      <UIcon
                        :name="typeConfig[item.type]?.icon || 'i-lucide-circle'"
                        class="size-4 shrink-0"
                        :class="typeConfig[item.type]?.color || 'text-muted'"
                      />
                      <span class="font-mono text-xs text-muted shrink-0">
                        {{ item.sourceTicketCode || item.itemKey }}
                      </span>
                      <span class="font-medium truncate">
                        {{ item.title }}
                      </span>
                    </div>
                    <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>{{ item.customerCode || '客户待同步' }}</span>
                      <span>{{ item.environmentCode || '环境待同步' }}</span>
                      <span>{{ item.milestoneName || '未分配周期' }}</span>
                    </div>
                  </div>
                  <div class="flex flex-wrap items-center gap-2 shrink-0">
                    <UBadge :color="(getStatusColor(item.status) as any)" variant="subtle">
                      {{ getStatusLabel(item.status) }}
                    </UBadge>
                    <UBadge :color="(dueState(item.resolutionDueAt || item.dueDate).color as any)" variant="subtle">
                      {{ dueState(item.resolutionDueAt || item.dueDate).label }}
                    </UBadge>
                    <UBadge :color="(slaSnapshotColor(item) as any)" variant="subtle">
                      {{ slaSnapshotText(item) }}
                    </UBadge>
                  </div>
                </div>
                <div class="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-muted">
                  <span>响应 {{ formatDateTime(item.responseDueAt) }}</span>
                  <span>解决 {{ formatDateTime(item.resolutionDueAt) }}</span>
                  <span>同步 {{ formatDateTime(item.serviceExtLastSyncedAt) }}</span>
                </div>
              </button>
            </div>
          </template>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
