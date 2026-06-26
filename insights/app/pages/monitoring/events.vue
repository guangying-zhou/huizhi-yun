<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { ref, reactive, computed, onMounted, watch, h } from 'vue'

const { apiBase } = useApiBase()

const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')
const toast = useToast()

// --- Interfaces ---
interface MonitoringEvent {
  id: number
  eventTypeId: number
  eventTypeName: string
  orgDepartmentId: number | null
  departmentName: string | null
  orgRepoId: number | null
  repoName: string | null
  orgPersonId: number | null
  personUsername: string | null
  personRealName: string | null
  repoCommitId: number | null
  commitHash: string | null
  eventLevelId: number
  eventLevelName: string
  monitoringTable: string
  evalFormula: string
  evalValue: number
  comparison: string
  monitoringThreshold: string
  thresholdValue: number
  message: string
  status: string
  sentAt: string | null
  readAt: string | null
  resolvedAt: string | null
  eventTime: string | null
  createdAt: string
  updatedAt: string
}

interface EventLevel { id: number, levelName: string }
interface EventType { id: number, eventName: string }
interface EventStats {
  statusCounts: Record<string, number>
  levelCounts: Array<{ eventLevelId: number, levelName: string, count: number }>
  summary: { total: number, pending: number, sent: number, read: number, resolved: number, ignored: number }
}

// --- State ---
const loading = reactive({ events: false, stats: false, updating: false, scanning: false })
const events = ref<MonitoringEvent[]>([])
const eventLevels = ref<EventLevel[]>([])
const eventTypes = ref<EventType[]>([])
const stats = ref<EventStats | null>(null)
const selectedEvent = ref<MonitoringEvent | null>(null)
const detailModalOpen = ref(false)

const pagination = ref({ total: 0, limit: 20, offset: 0, hasMore: false })
const filters = reactive({ status: 'all', eventLevelId: 0, eventTypeId: 0, search: '' })
const startDateStr = ref('')
const endDateStr = ref('')

function onStartDateUpdate(date: string) { startDateStr.value = date }
function onEndDateUpdate(date: string) { endDateStr.value = date }

const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '待处理', value: 'PENDING' },
  { label: '已发送', value: 'SENT' },
  { label: '已读', value: 'READ' },
  { label: '已解决', value: 'RESOLVED' },
  { label: '已忽略', value: 'IGNORED' }
]

const eventLevelOptions = computed(() => [
  { label: '全部级别', value: 0 },
  ...eventLevels.value.map(l => ({ label: l.levelName, value: l.id }))
])

const eventTypeOptions = computed(() => [
  { label: '全部类型', value: 0 },
  ...eventTypes.value.map(t => ({ label: t.eventName, value: t.id }))
])

async function loadEvents() {
  loading.events = true
  try {
    const params: Record<string, any> = { limit: pagination.value.limit, offset: pagination.value.offset }
    if (filters.status !== 'all') params.status = filters.status
    if (filters.eventLevelId) params.eventLevelId = filters.eventLevelId
    if (filters.eventTypeId) params.eventTypeId = filters.eventTypeId
    if (startDateStr.value) params.startDate = startDateStr.value
    if (endDateStr.value) params.endDate = endDateStr.value

    const response = await $fetch<{ data: MonitoringEvent[], pagination: any }>(`${apiBase}/monitoring/events`, { params })
    events.value = response.data
    pagination.value = { ...pagination.value, ...response.pagination }
  } catch (error: any) {
    toast.add({ title: '加载失败', description: error.message, color: 'error' })
  } finally {
    loading.events = false
  }
}

const page = computed({
  get: () => Math.floor(pagination.value.offset / pagination.value.limit) + 1,
  set: (val) => {
    pagination.value.offset = (val - 1) * pagination.value.limit
    loadEvents()
  }
})

async function loadStats() {
  loading.stats = true
  try {
    const response = await $fetch<{ data: EventStats }>(`${apiBase}/monitoring/events/stats`)
    stats.value = response.data
  } catch (error: any) {
    toast.add({ title: '加载统计失败', description: error.message, color: 'error' })
  } finally {
    loading.stats = false
  }
}

async function loadEventLevels() {
  try {
    const response = await $fetch<{ data: EventLevel[] }>(`${apiBase}/monitoring/event-levels`)
    eventLevels.value = response.data
  } catch (error) { }
}

async function loadEventTypes() {
  try {
    const response = await $fetch<{ data: EventType[] }>(`${apiBase}/monitoring/event-types`)
    eventTypes.value = response.data
  } catch (error) { }
}

async function refreshAll() {
  await Promise.all([loadEvents(), loadStats(), loadEventLevels(), loadEventTypes()])
}

async function updateEventStatus(eventId: number, status: string) {
  loading.updating = true
  try {
    await ($fetch as any)(`${apiBase}/monitoring/events/${eventId}`, { method: 'PUT', body: { status } })
    toast.add({ title: '状态更新成功', color: 'success' })
    await refreshAll()
  } catch (error: any) {
    toast.add({ title: '更新失败', description: error.message, color: 'error' })
  } finally {
    loading.updating = false
  }
}

async function deleteEvent(eventId: number) {
  if (!confirm('确定要删除这条事件吗？')) return
  try {
    await ($fetch as any)(`${apiBase}/monitoring/events/${eventId}`, { method: 'DELETE' })
    toast.add({ title: '删除成功', color: 'success' })
    await refreshAll()
  } catch (error: any) {
    toast.add({ title: '删除失败', description: error.message, color: 'error' })
  }
}

const scanModalOpen = ref(false)
const scanStartDate = ref('')

async function openScanModal() {
  try {
    const response = await $fetch<{ data: { monitoringStartDate: string } }>(`${apiBase}/monitoring/start-date`)
    scanStartDate.value = response.data.monitoringStartDate?.split(' ')[0] || '2024-01-01'
  } catch (error) {
    scanStartDate.value = '2024-01-01'
  }
  scanModalOpen.value = true
}

async function executeScan() {
  scanModalOpen.value = false
  loading.scanning = true
  try {
    const result = await ($fetch as any)<{ eventsCreated: number }>(`${apiBase}/monitoring/scan`, {
      method: 'POST',
      body: { fromDate: scanStartDate.value }
    })
    toast.add({ title: '扫描完成', description: `已创建 ${result.eventsCreated} 个事件`, color: 'success' })
    await refreshAll()
  } catch (error: any) {
    toast.add({ title: '扫描失败', description: error.message, color: 'error' })
  } finally {
    loading.scanning = false
  }
}

function openDetailModal(event: MonitoringEvent) {
  selectedEvent.value = event
  detailModalOpen.value = true
}

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const getLevelColor = (levelId: number) => {
  if (levelId === 1) return 'error'
  if (levelId === 2) return 'warning'
  if (levelId === 3) return 'info'
  return 'neutral'
}

const getStatusColor = (status: string) => {
  if (status === 'PENDING') return 'secondary'
  if (status === 'SENT') return 'primary'
  if (status === 'READ') return 'info'
  if (status === 'RESOLVED') return 'success'
  if (status === 'IGNORED') return 'neutral'
  return 'neutral'
}

const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    PENDING: '待处理', SENT: '已发送', READ: '已读', RESOLVED: '已解决', IGNORED: '已忽略'
  }
  return map[status] || status
}

const showCommitModal = ref(false)
const selectedCommitId = ref<number | null>(null)
const openCommitModal = (commitId: number) => {
  selectedCommitId.value = commitId
  showCommitModal.value = true
}

const columns: TableColumn<MonitoringEvent>[] = [
  { accessorKey: 'eventLevelName', header: '级别', cell: ({ row }) => h(UBadge, { color: getLevelColor(row.original.eventLevelId), size: 'sm' }, () => row.original.eventLevelName) },
  { accessorKey: 'eventTypeName', header: '类型' },
  { accessorKey: 'message', header: '消息', cell: ({ row }) => h('div', { class: 'max-w-md truncate', title: row.original.message }, row.original.message) },
  { accessorKey: 'personUsername', header: '人员', cell: ({ row }) => row.original.personUsername || '-' },
  { accessorKey: 'repoName', header: '仓库', cell: ({ row }) => row.original.repoName || '-' },
  { accessorKey: 'evalValue', header: '计算值', cell: ({ row }) => parseFloat(Number(row.original.evalValue).toFixed(2)) },
  { accessorKey: 'status', header: '状态', cell: ({ row }) => h(UBadge, { color: getStatusColor(row.original.status), size: 'sm' }, () => getStatusText(row.original.status)) },
  { accessorKey: 'eventTime', header: '事件时间', cell: ({ row }) => formatDate(row.original.eventTime) },
  {
    accessorKey: 'actions', header: '操作', cell: ({ row }) => h('div', { class: 'flex items-center gap-1' }, [
      h(UButton, { icon: 'i-lucide-eye', size: 'xs', color: 'neutral', variant: 'ghost', onClick: () => openDetailModal(row.original) }),
      row.original.status === 'PENDING' && h(UButton, { icon: 'i-lucide-check', size: 'xs', color: 'success', variant: 'ghost', onClick: () => updateEventStatus(row.original.id, 'READ') }),
      h(UButton, { icon: 'i-lucide-trash-2', size: 'xs', color: 'neutral', variant: 'ghost', onClick: () => deleteEvent(row.original.id) })
    ])
  }
]

onMounted(() => { refreshAll() })

watch(
  [() => filters.status, () => filters.eventLevelId, () => filters.eventTypeId, startDateStr, endDateStr],
  () => { pagination.value.offset = 0; loadEvents() }
)
</script>

<template>
  <UDashboardPanel grow>
    <UDashboardNavbar title="异动监控事件">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #right>
        <UButton
          icon="i-lucide-scan"
          label="触发扫描"
          color="primary"
          size="sm"
          :loading="loading.scanning"
          @click="openScanModal"
        />
        <UButton
          icon="i-lucide-rotate-ccw"
          color="neutral"
          variant="ghost"
          size="sm"
          :loading="loading.events || loading.stats"
          @click="refreshAll"
        />
      </template>
    </UDashboardNavbar>

    <!-- Statistics Cards -->
    <div
      v-if="stats"
      class="grid grid-cols-6 gap-3 px-3 py-2"
    >
      <UCard :ui="{ header: 'p-0 sm:p-2', body: 'p-0 sm:p-2' }">
        <div class="flex items-center justify-center p-0">
          <div class="text-xs text-muted-500 pr-4 pt-2">
            总计
          </div>
          <div class="text-2xl font-semibold">
            {{ stats.summary.total }}
          </div>
        </div>
      </UCard>
      <UCard :ui="{ header: 'p-0 sm:p-2', body: 'p-0 sm:p-2' }">
        <div class="flex items-center justify-center">
          <div class="text-xs text-warning-500 pr-4 pt-2">
            待处理
          </div>
          <div class="text-2xl font-semibold text-warning-600">
            {{ stats.summary.pending }}
          </div>
        </div>
      </UCard>
      <UCard :ui="{ header: 'p-0 sm:p-2', body: 'p-0 sm:p-2' }">
        <div class="flex items-center justify-center">
          <div class="text-xs text-primary-500 pr-4 pt-2">
            已发送
          </div>
          <div class="text-2xl font-semibold text-primary-600">
            {{ stats.summary.sent }}
          </div>
        </div>
      </UCard>
      <UCard :ui="{ header: 'p-0 sm:p-2', body: 'p-0 sm:p-2' }">
        <div class="flex items-center justify-center">
          <div class="text-xs text-info-500 pr-4 pt-2">
            已读
          </div>
          <div class="text-2xl font-semibold text-info-600">
            {{ stats.summary.read }}
          </div>
        </div>
      </UCard>
      <UCard :ui="{ header: 'p-0 sm:p-2', body: 'p-0 sm:p-2' }">
        <div class="flex items-center justify-center">
          <div class="text-xs text-success-500 pr-4 pt-2">
            已解决
          </div>
          <div class="text-2xl font-semibold text-success-600">
            {{ stats.summary.resolved }}
          </div>
        </div>
      </UCard>
      <UCard :ui="{ header: 'p-0 sm:p-2', body: 'p-0 sm:p-2' }">
        <div class="flex items-center justify-center">
          <div class="text-xs text-muted-500 pr-4 pt-2">
            已忽略
          </div>
          <div class="text-2xl font-semibold text-muted-600">
            {{ stats.summary.ignored }}
          </div>
        </div>
      </UCard>
    </div>

    <!-- Filters -->
    <UDashboardToolbar>
      <template #left>
        <div class="flex items-center gap-3">
          <span class="text-sm">状态:</span>
          <URadioGroup
            v-model="filters.status"
            :items="statusOptions"
            orientation="horizontal"
            size="sm"
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm">级别:</span>
          <USelect
            v-model="filters.eventLevelId"
            :items="eventLevelOptions"
            value-key="value"
            label-key="label"
            size="sm"
            class="min-w-[120px]"
          />
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm">类型:</span>
          <USelect
            v-model="filters.eventTypeId"
            :items="eventTypeOptions"
            value-key="value"
            label-key="label"
            size="sm"
            class="min-w-[150px]"
          />
        </div>
      </template>
      <template #right>
        <span class="text-sm">时间范围:</span>
        <RepoinsightDateRangePicker
          @update:start-date="onStartDateUpdate"
          @update:end-date="onEndDateUpdate"
        />
      </template>
    </UDashboardToolbar>

    <!-- Events Table -->
    <div class="px-4 py-2">
      <UCard :ui="{ header: 'p-2 sm:p-2', body: 'p-2 sm:p-2', footer: 'p-2 sm:p-2' }">
        <UTable
          :columns="columns"
          :data="events"
          :loading="loading.events"
          sticky
          class="h-[calc(100vh-240px)] pt-2"
        />
        <div
          v-if="!loading.events && events.length === 0"
          class="py-10 text-center text-sm text-muted-500"
        >
          暂无事件
        </div>
        <div
          class="px-4 py-2 text-center text-xs text-muted-500 border-t border-gray-100 dark:border-gray-800 flex justify-between items-center"
        >
          <span v-if="!loading.events && events.length > 0">共 {{ pagination.total }} 条事件</span>
          <span v-else>&nbsp;</span>
          <UPagination
            v-if="pagination.total > 0"
            v-model:page="page"
            :total="pagination.total"
            :sibling-count="1"
            :items-per-page="pagination.limit"
            size="xs"
            :disabled="loading.events"
            show-edges
          />
        </div>
      </UCard>
    </div>

    <!-- Detail Modal -->
    <UModal
      v-model:open="detailModalOpen"
      title="事件详情"
      :ui="{ content: 'sm:max-w-3xl' }"
    >
      <template
        v-if="selectedEvent"
        #body
      >
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="事件级别">
              <UBadge :color="getLevelColor(selectedEvent.eventLevelId)">
                {{ selectedEvent.eventLevelName
                }}
              </UBadge>
            </UFormField>
            <UFormField label="事件类型">
              <span>{{ selectedEvent.eventTypeName }}</span>
            </UFormField>
            <UFormField label="状态">
              <UBadge :color="getStatusColor(selectedEvent.status)">
                {{ getStatusText(selectedEvent.status)
                }}
              </UBadge>
            </UFormField>
            <UFormField label="创建时间">
              <span class="text-sm">{{ formatDate(selectedEvent.createdAt) }}</span>
            </UFormField>
          </div>
          <UFormField label="消息">
            <div class="p-3 bg-gray-50 dark:bg-gray-800 rounded text-sm">
              {{ selectedEvent.message }}
            </div>
          </UFormField>
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="人员">
              <span>{{ selectedEvent.personUsername || '-' }}</span>
            </UFormField>
            <UFormField label="仓库">
              <span>{{ selectedEvent.repoName || '-' }}</span>
            </UFormField>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-between items-center w-full">
          <div class="flex gap-2">
            <UButton
              v-if="selectedEvent && selectedEvent.status === 'PENDING'"
              label="标记为已读"
              color="primary"
              @click="updateEventStatus(selectedEvent.id, 'READ'); detailModalOpen = false"
            />
            <UButton
              v-if="selectedEvent && (selectedEvent.status === 'PENDING' || selectedEvent.status === 'READ')"
              label="标记为已解决"
              color="success"
              @click="updateEventStatus(selectedEvent.id, 'RESOLVED'); detailModalOpen = false"
            />
          </div>
          <UButton
            label="关闭"
            color="neutral"
            variant="subtle"
            @click="detailModalOpen = false"
          />
        </div>
      </template>
    </UModal>

    <!-- Scan Modal -->
    <UModal
      v-model:open="scanModalOpen"
      title="触发监控扫描"
      :ui="{ content: 'sm:max-w-md' }"
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            扫描将从指定日期开始，检测所有启用的监控规则。
          </p>
          <UFormField label="扫描起始日期">
            <UInput
              v-model="scanStartDate"
              type="date"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-3">
          <UButton
            label="取消"
            color="neutral"
            variant="ghost"
            @click="scanModalOpen = false"
          />
          <UButton
            label="开始扫描"
            color="primary"
            icon="i-lucide-scan"
            @click="executeScan"
          />
        </div>
      </template>
    </UModal>

    <RepoinsightCommitDetailModal
      v-if="selectedCommitId"
      v-model="showCommitModal"
      :commit-id="selectedCommitId"
    />
  </UDashboardPanel>
</template>
