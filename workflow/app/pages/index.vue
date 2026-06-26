<script setup lang="ts">
import { format } from 'date-fns'

usePageTitle('汇智云流程')
const { setRefresh, clearRefresh } = usePageActions()

const { user: authUser } = useAuth()
const displayName = computed(() => {
  const realname = useCookie('auth_realname').value
  return realname || authUser.value || '用户'
})

interface PendingTask {
  task_id: number
  instance_id: number
  instance_no: string
  action_name: string | null
  biz_title: string
  initiator_uid: string
  node_name: string
  created_at: string
}

const stats = ref({
  pendingCount: 0,
  initiatedCount: 0,
  doneCount: 0
})

const recentTasks = ref<PendingTask[]>([])
const loading = ref(true)

const columns = [
  { accessorKey: 'biz_title', header: '事项标题' },
  { accessorKey: 'action_name', header: '流程类型' },
  { accessorKey: 'node_name', header: '当前节点' },
  { accessorKey: 'initiator_uid', header: '发起人' },
  { accessorKey: 'created_at', header: '创建时间' }
]

const formatDate = (date: string) => {
  if (!date) return '-'
  return format(new Date(date), 'yyyy-MM-dd HH:mm')
}

const loadData = async () => {
  loading.value = true
  try {
    const [pendingRes, initiatedRes, doneRes] = await Promise.all([
      $fetch<{ code: number, data: { total: number, items: PendingTask[] } }>('/api/v1/tasks/pending', {
        query: { page: 1, page_size: 5 }
      }),
      $fetch<{ code: number, data: { total: number } }>('/api/v1/tasks/initiated', {
        query: { page: 1, page_size: 1 }
      }),
      $fetch<{ code: number, data: { total: number } }>('/api/v1/tasks/done', {
        query: { page: 1, page_size: 1 }
      })
    ])

    stats.value.pendingCount = pendingRes.data.total
    stats.value.initiatedCount = initiatedRes.data.total
    stats.value.doneCount = doneRes.data.total
    recentTasks.value = pendingRes.data.items
  } catch (error) {
    console.error('加载工作台数据失败:', error)
  } finally {
    loading.value = false
  }
}

const handleRowClick = (_e: Event, row: { original: PendingTask }) => {
  navigateTo(`/tasks/${row.original.task_id}`)
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
  <UDashboardPanel id="home" grow>
    <template #body>
      <div class="space-y-6 p-4">
        <!-- 欢迎 -->
        <div>
          <h2 class="text-lg font-semibold">
            欢迎，{{ displayName }}
          </h2>
          <p class="text-sm text-muted mt-1">
            这里是您的流程审批工作台
          </p>
        </div>

        <!-- 统计卡片 -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <UCard
            class="cursor-pointer hover:shadow-md transition-shadow"
            @click="navigateTo('/tasks')"
          >
            <div class="flex items-center gap-4">
              <div class="flex items-center justify-center w-12 h-12 rounded-lg bg-warning/10">
                <UIcon name="i-lucide-clock" class="text-2xl text-warning" />
              </div>
              <div>
                <div class="text-3xl font-bold text-warning">
                  {{ stats.pendingCount }}
                </div>
                <div class="text-sm text-muted mt-0.5">
                  待办任务
                </div>
              </div>
            </div>
          </UCard>

          <UCard
            class="cursor-pointer hover:shadow-md transition-shadow"
            @click="navigateTo('/instances')"
          >
            <div class="flex items-center gap-4">
              <div class="flex items-center justify-center w-12 h-12 rounded-lg bg-info/10">
                <UIcon name="i-lucide-send" class="text-2xl text-info" />
              </div>
              <div>
                <div class="text-3xl font-bold text-info">
                  {{ stats.initiatedCount }}
                </div>
                <div class="text-sm text-muted mt-0.5">
                  我发起的
                </div>
              </div>
            </div>
          </UCard>

          <UCard
            class="cursor-pointer hover:shadow-md transition-shadow"
            @click="navigateTo('/tasks')"
          >
            <div class="flex items-center gap-4">
              <div class="flex items-center justify-center w-12 h-12 rounded-lg bg-success/10">
                <UIcon name="i-lucide-check-circle" class="text-2xl text-success" />
              </div>
              <div>
                <div class="text-3xl font-bold text-success">
                  {{ stats.doneCount }}
                </div>
                <div class="text-sm text-muted mt-0.5">
                  已办结
                </div>
              </div>
            </div>
          </UCard>
        </div>

        <!-- 最近待办 -->
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h3 class="font-semibold flex items-center gap-2">
                <UIcon name="i-lucide-list-todo" />
                最近待办
              </h3>
              <UButton
                variant="link"
                color="primary"
                size="sm"
                trailing-icon="i-lucide-arrow-right"
                @click="navigateTo('/tasks')"
              >
                查看全部
              </UButton>
            </div>
          </template>

          <UTable
            :data="recentTasks"
            :columns="columns"
            :loading="loading"
            @select="handleRowClick"
          >
            <template #biz_title-cell="{ row }">
              <span class="font-medium">{{ row.original.biz_title }}</span>
            </template>

            <template #action_name-cell="{ row }">
              <UBadge color="info" variant="subtle">
                {{ row.original.action_name || '-' }}
              </UBadge>
            </template>

            <template #created_at-cell="{ row }">
              <span class="text-sm text-muted">
                {{ formatDate(row.original.created_at) }}
              </span>
            </template>
          </UTable>

          <div v-if="!loading && recentTasks.length === 0" class="flex flex-col items-center justify-center py-8">
            <UIcon name="i-lucide-inbox" class="text-5xl text-muted mb-3" />
            <p class="text-sm text-muted">
              暂无待办任务
            </p>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
