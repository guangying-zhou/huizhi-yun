<template>
  <UDashboardPanel grow>
    <div class="p-4">
      <!-- Tabs -->
      <UTabs v-model="activeTab" :items="tabs" class="mb-4" />

      <!-- 列表 -->
      <UTable
        :data="reviews"
        :columns="columns"
        :loading="loading"
        @select="handleRowClick"
      >
        <template #document_title-cell="{ row }">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-file-text" class="text-gray-400" />
            <span class="font-medium">{{ row.original.document_title }}</span>
          </div>
        </template>

        <template #review_type-cell="{ row }">
          <UBadge color="info" variant="subtle">
            {{ row.original.review_type }}
            {{ row.original.sub_type ? ` - ${row.original.sub_type}` : '' }}
          </UBadge>
        </template>

        <template #status-cell="{ row }">
          <UBadge :color="getStatusColor(row.original.status)">
            {{ getStatusLabel(row.original.status) }}
          </UBadge>
        </template>

        <template #current_node-cell="{ row }">
          <span v-if="row.original.status === 'in_progress'" class="text-sm">
            {{ getCurrentNodeName(row.original) }}
          </span>
          <span v-else class="text-sm text-gray-500">-</span>
        </template>

        <template #created_at-cell="{ row }">
          <span class="text-sm text-gray-600">
            {{ formatDate(row.original.created_at) }}
          </span>
        </template>

        <template #actions-cell="{ row }">
          <UButton
            icon="i-lucide-eye"
            size="xs"
            color="neutral"
            variant="ghost"
            @click.stop="navigateTo(`/reviews/${row.original.id}`)"
          >
            查看
          </UButton>
        </template>
      </UTable>

      <!-- 空状态 -->
      <div v-if="!loading && reviews.length === 0" class="flex flex-col items-center justify-center py-12">
        <UIcon name="i-lucide-clipboard-check" class="text-6xl text-gray-300 mb-4" />
        <p class="text-gray-500">
          暂无审阅记录
        </p>
      </div>
    </div>
  </UDashboardPanel>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'default'
})

usePageTitle('审阅中心')
const { setRefresh } = usePageActions()
setRefresh(() => refresh())

interface FlowNode {
  id: number
  [key: string]: unknown
}

interface ReviewRecord {
  id: number
  document_uuid: string
  document_title: string
  review_type: string
  sub_type?: string
  status: string
  current_node: number
  flow_snapshot?: FlowNode[]
  created_at: string
}

const activeTab = ref('initiated')
const loading = ref(false)
const reviews = ref<ReviewRecord[]>([])

const tabs = [
  { label: '我发起的', value: 'initiated' },
  { label: '待我审阅', value: 'pending' },
  { label: '已完成', value: 'completed' }
]

interface Column {
  accessorKey?: string
  id?: string
  header: string
}

const columns: Column[] = [
  { accessorKey: 'document_title', header: '文档标题' },
  { accessorKey: 'review_type', header: '审阅类型' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'current_node', header: '当前节点' },
  { accessorKey: 'created_at', header: '提交时间' },
  { id: 'actions', header: '操作' }
]

// 监听 Tab 切换
watch(activeTab, () => {
  loadReviews()
})

// 加载审阅列表
const loadReviews = async () => {
  loading.value = true
  try {
    const { data } = await $fetch<{ data: ReviewRecord[] }>('/api/reviews/my', {
      query: { type: activeTab.value }
    })
    reviews.value = data || []
  } catch (error) {
    console.error('Failed to load reviews:', error)
    reviews.value = []
  } finally {
    loading.value = false
  }
}

// 刷新
const refresh = () => {
  loadReviews()
}

// 行点击
const handleRowClick = (_e: Event, row: { original: ReviewRecord }) => {
  navigateTo(`/reviews/${row.original.id}`)
}

// 获取状态颜色
const getStatusColor = (status: string): 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | undefined => {
  const colors: Record<string, 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'> = {
    pending: 'neutral',
    in_progress: 'info',
    approved: 'success',
    rejected: 'error',
    archived: 'secondary'
  }
  return colors[status] || 'neutral'
}

// 获取状态标签
const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    pending: '待处理',
    in_progress: '审阅中',
    approved: '已通过',
    rejected: '已驳回',
    archived: '已发布'
  }
  return labels[status] || status
}

// 获取当前节点名称
const getCurrentNodeName = (row: ReviewRecord) => {
  if (!row.flow_snapshot) return '-'
  const node = row.flow_snapshot[row.current_node]
  return node?.name || `节点${row.current_node + 1}`
}

// 格式化日期
const formatDate = (date: string) => {
  return new Date(date).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 初始加载
onMounted(() => {
  loadReviews()
})
</script>
