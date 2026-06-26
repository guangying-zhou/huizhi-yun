<script setup lang="ts">
import { format } from 'date-fns'

usePageTitle('我发起的')
const { setRefresh, clearRefresh } = usePageActions()

interface InstanceItem {
  instance_id: number
  instance_no: string
  resource_code: string
  action_code: string
  action_name: string | null
  biz_title: string
  biz_url: string | null
  status: string
  current_node: number
  created_at: string
  completed_at: string | null
}

const loading = ref(false)
const instances = ref<InstanceItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20

const columns = [
  { accessorKey: 'instance_no', header: '流程编号' },
  { accessorKey: 'biz_title', header: '事项标题' },
  { accessorKey: 'action_name', header: '流程类型' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'created_at', header: '发起时间' }
]

const formatDate = (date: string | null) => {
  if (!date) return '-'
  return format(new Date(date), 'yyyy-MM-dd HH:mm')
}

const getStatusColor = (status: string): 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' => {
  const colors: Record<string, 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'> = {
    running: 'warning',
    approved: 'success',
    rejected: 'error',
    cancelled: 'neutral'
  }
  return colors[status] || 'neutral'
}

const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    running: '进行中',
    approved: '已通过',
    rejected: '已驳回',
    cancelled: '已取消'
  }
  return labels[status] || status
}

const totalPages = computed(() => Math.ceil(total.value / pageSize))

const loadInstances = async () => {
  loading.value = true
  try {
    const res = await $fetch<{ code: number, data: { total: number, items: InstanceItem[] } }>('/api/v1/tasks/initiated', {
      query: { page: page.value, page_size: pageSize }
    })
    instances.value = res.data.items
    total.value = res.data.total
  } catch (error) {
    console.error('加载流程列表失败:', error)
  } finally {
    loading.value = false
  }
}

watch(page, () => {
  loadInstances()
})

const handleRowClick = (_e: Event, row: { original: InstanceItem }) => {
  navigateTo(`/instances/${row.original.instance_id}`)
}

onMounted(() => {
  loadInstances()
  setRefresh(loadInstances)
})

onBeforeUnmount(() => {
  clearRefresh()
})
</script>

<template>
  <UDashboardPanel id="instances" grow>
    <template #body>
      <div class="p-4 space-y-4">
        <UTable
          :data="instances"
          :columns="columns"
          :loading="loading"
          @select="handleRowClick"
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

          <template #status-cell="{ row }">
            <UBadge :color="getStatusColor(row.original.status)">
              {{ getStatusLabel(row.original.status) }}
            </UBadge>
          </template>

          <template #created_at-cell="{ row }">
            <span class="text-sm text-(--ui-text-muted)">
              {{ formatDate(row.original.created_at) }}
            </span>
          </template>
        </UTable>

        <div v-if="!loading && instances.length === 0" class="flex flex-col items-center justify-center py-12">
          <UIcon name="i-lucide-inbox" class="text-5xl text-(--ui-text-dimmed) mb-3" />
          <p class="text-(--ui-text-muted)">
            暂无发起的流程
          </p>
        </div>

        <div v-if="totalPages > 1" class="flex justify-center mt-4">
          <UPagination v-model="page" :total="total" :items-per-page="pageSize" />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
