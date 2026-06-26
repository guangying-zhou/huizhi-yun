<script setup lang="ts">
import { format } from 'date-fns'

usePageTitle('我的任务')
const { setRefresh, clearRefresh } = usePageActions()

interface PendingTask {
  task_id: number
  instance_id: number
  instance_no: string
  resource_code: string
  action_code: string
  action_name: string | null
  biz_title: string
  biz_url: string | null
  initiator_uid: string
  node_name: string
  task_type: string
  created_at: string
  due_at: string | null
}

interface DoneTask {
  task_id: number
  instance_id: number
  instance_no: string
  resource_code: string
  action_code: string
  action_name: string | null
  biz_title: string
  biz_url: string | null
  initiator_uid: string
  instance_status: string
  node_name: string
  task_type: string
  completed_at: string | null
  created_at: string
}

const activeTab = ref('pending')
const loading = ref(false)
const pendingTasks = ref<PendingTask[]>([])
const doneTasks = ref<DoneTask[]>([])
const pendingTotal = ref(0)
const doneTotal = ref(0)
const pendingPage = ref(1)
const donePage = ref(1)
const pageSize = 20

const tabs = [
  { label: '待办', value: 'pending' },
  { label: '已办', value: 'done' }
]

const pendingColumns = [
  { accessorKey: 'instance_no', header: '流程编号' },
  { accessorKey: 'biz_title', header: '事项标题' },
  { accessorKey: 'action_name', header: '流程类型' },
  { accessorKey: 'node_name', header: '当前节点' },
  { accessorKey: 'initiator_uid', header: '发起人' },
  { accessorKey: 'created_at', header: '创建时间' }
]

const doneColumns = [
  { accessorKey: 'instance_no', header: '流程编号' },
  { accessorKey: 'biz_title', header: '事项标题' },
  { accessorKey: 'action_name', header: '流程类型' },
  { accessorKey: 'node_name', header: '处理节点' },
  { accessorKey: 'initiator_uid', header: '发起人' },
  { accessorKey: 'instance_status', header: '流程状态' },
  { accessorKey: 'created_at', header: '处理时间' }
]

const formatDate = (date: string | null) => {
  if (!date) return '-'
  return format(new Date(date), 'yyyy-MM-dd HH:mm')
}

const getInstanceStatusColor = (status: string): 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' => {
  const colors: Record<string, 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'> = {
    running: 'warning',
    approved: 'success',
    rejected: 'error',
    cancelled: 'neutral'
  }
  return colors[status] || 'neutral'
}

const getInstanceStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    running: '进行中',
    approved: '已通过',
    rejected: '已驳回',
    cancelled: '已取消'
  }
  return labels[status] || status
}

const loadPendingTasks = async () => {
  loading.value = true
  try {
    const res = await $fetch<{ code: number, data: { total: number, items: PendingTask[] } }>('/api/v1/tasks/pending', {
      query: { page: pendingPage.value, page_size: pageSize }
    })
    pendingTasks.value = res.data.items
    pendingTotal.value = res.data.total
  } catch (error) {
    console.error('加载待办任务失败:', error)
  } finally {
    loading.value = false
  }
}

const loadDoneTasks = async () => {
  loading.value = true
  try {
    const res = await $fetch<{ code: number, data: { total: number, items: DoneTask[] } }>('/api/v1/tasks/done', {
      query: { page: donePage.value, page_size: pageSize }
    })
    doneTasks.value = res.data.items
    doneTotal.value = res.data.total
  } catch (error) {
    console.error('加载已办任务失败:', error)
  } finally {
    loading.value = false
  }
}

const loadData = () => {
  if (activeTab.value === 'pending') {
    loadPendingTasks()
  } else {
    loadDoneTasks()
  }
}

watch(activeTab, () => {
  loadData()
})

const pendingTotalPages = computed(() => Math.ceil(pendingTotal.value / pageSize))
const doneTotalPages = computed(() => Math.ceil(doneTotal.value / pageSize))

watch(pendingPage, () => {
  loadPendingTasks()
})

watch(donePage, () => {
  loadDoneTasks()
})

const handlePendingRowClick = (_e: Event, row: { original: PendingTask }) => {
  navigateTo(`/tasks/${row.original.task_id}`)
}

const handleDoneRowClick = (_e: Event, row: { original: DoneTask }) => {
  navigateTo(`/instances/${row.original.instance_id}`)
}

onMounted(() => {
  loadData()
  setRefresh(loadData)
})

onBeforeUnmount(() => {
  clearRefresh()
})
</script>

<template>
  <UDashboardPanel id="tasks" grow>
    <template #body>
      <div class="p-4 space-y-4">
        <UTabs v-model="activeTab" :items="tabs" />

        <!-- 待办列表 -->
        <div v-if="activeTab === 'pending'">
          <UTable
            :data="pendingTasks"
            :columns="pendingColumns"
            :loading="loading"
            @select="handlePendingRowClick"
          >
            <template #instance_no-cell="{ row }">
              <span class="text-sm font-mono">{{ row.original.instance_no }}</span>
            </template>

            <template #biz_title-cell="{ row }">
              <span class="font-medium">{{ row.original.biz_title }}</span>
            </template>

            <template #action_name-cell="{ row }">
              <UBadge color="info" variant="subtle">
                {{ row.original.action_name || '-' }}
              </UBadge>
            </template>

            <template #created_at-cell="{ row }">
              <span class="text-sm text-(--ui-text-muted)">
                {{ formatDate(row.original.created_at) }}
              </span>
            </template>
          </UTable>

          <div v-if="!loading && pendingTasks.length === 0" class="flex flex-col items-center justify-center py-12">
            <UIcon name="i-lucide-inbox" class="text-5xl text-(--ui-text-dimmed) mb-3" />
            <p class="text-(--ui-text-muted)">
              暂无待办任务
            </p>
          </div>

          <div v-if="pendingTotalPages > 1" class="flex justify-center mt-4">
            <UPagination v-model="pendingPage" :total="pendingTotal" :items-per-page="pageSize" />
          </div>
        </div>

        <!-- 已办列表 -->
        <div v-if="activeTab === 'done'">
          <UTable
            :data="doneTasks"
            :columns="doneColumns"
            :loading="loading"
            @select="handleDoneRowClick"
          >
            <template #instance_no-cell="{ row }">
              <span class="text-sm font-mono">{{ row.original.instance_no }}</span>
            </template>

            <template #biz_title-cell="{ row }">
              <span class="font-medium">{{ row.original.biz_title }}</span>
            </template>

            <template #action_name-cell="{ row }">
              <UBadge color="info" variant="subtle">
                {{ row.original.action_name || '-' }}
              </UBadge>
            </template>

            <template #instance_status-cell="{ row }">
              <UBadge :color="getInstanceStatusColor(row.original.instance_status)">
                {{ getInstanceStatusLabel(row.original.instance_status) }}
              </UBadge>
            </template>

            <template #created_at-cell="{ row }">
              <span class="text-sm text-(--ui-text-muted)">
                {{ formatDate(row.original.completed_at || row.original.created_at) }}
              </span>
            </template>
          </UTable>

          <div v-if="!loading && doneTasks.length === 0" class="flex flex-col items-center justify-center py-12">
            <UIcon name="i-lucide-inbox" class="text-5xl text-(--ui-text-dimmed) mb-3" />
            <p class="text-(--ui-text-muted)">
              暂无已办任务
            </p>
          </div>

          <div v-if="doneTotalPages > 1" class="flex justify-center mt-4">
            <UPagination v-model="donePage" :total="doneTotal" :items-per-page="pageSize" />
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
