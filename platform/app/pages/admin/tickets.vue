<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layout: 'platform' })
usePageTitle('工单管理')

interface TicketItem {
  id: number
  ticketNo: string
  tenantCode: string | null
  tenantName: string | null
  title: string
  category: string
  priority: string
  status: string
  reporterContact: string | null
  assigneeUid: string | null
  assigneeName: string | null
  createdAt: string
  updatedAt: string
  closedAt: string | null
}
interface ListResponse { items: TicketItem[], total: number, page: number, pageSize: number }
interface ApiEnvelope<T> { success: true, data: T }

const q = ref('')
const status = ref('all')
const priority = ref('all')
const page = ref(1)
const pageSize = 20
const pending = ref(false)
const error = ref<unknown>(null)
const data = ref<ApiEnvelope<ListResponse> | null>(null)
const statusItems = [{ label: '状态：全部', value: 'all' }, { label: '待处理', value: 'open' }, { label: '处理中', value: 'in_progress' }, { label: '已关闭', value: 'closed' }]
const priorityItems = [{ label: '优先级：全部', value: 'all' }, { label: '紧急', value: 'urgent' }, { label: '高', value: 'high' }, { label: '普通', value: 'normal' }, { label: '低', value: 'low' }]
const columns: TableColumn<TicketItem>[] = [
  { id: 'ticket', header: '工单' }, { id: 'tenant', header: '企业' }, { id: 'category', header: '分类' },
  { id: 'priority', header: '优先级' }, { id: 'status', header: '状态' }, { id: 'assignee', header: '处理人' }, { id: 'updatedAt', header: '更新时间' }
]
const listQuery = computed(() => ({ keyword: q.value || undefined, status: status.value, priority: priority.value, page: page.value, pageSize }))
const rows = computed(() => data.value?.data.items || [])
const total = computed(() => data.value?.data.total || 0)

async function refresh() {
  pending.value = true
  error.value = null
  try {
    data.value = await platformFetchJson<ApiEnvelope<ListResponse>>('/api/platform/ops/tickets', { query: listQuery.value })
  } catch (caught) {
    error.value = caught
  } finally {
    pending.value = false
  }
}
function formatDateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

await refresh()
watch([q, status, priority], () => {
  page.value = 1
})
watch(listQuery, () => {
  void refresh()
})
</script>

<template>
  <div>
    <div class="page-h">
      <div><h1>工单管理</h1><p>集中查看租户支持工单、优先级、处理人和当前状态。</p></div><div class="page-h-actions">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="pending"
          @click="refresh"
        >
          刷新
        </UButton>
      </div>
    </div>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="工单加载失败"
      :description="String((error as any)?.data?.message || (error as any)?.message || '请稍后重试')"
      class="mb-4"
    />
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="toolbar">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          placeholder="搜索工单号 / 标题 / 企业 / 联系人"
          size="sm"
          class="w-full max-w-80"
        /><USelect
          v-model="status"
          :items="statusItems"
          size="sm"
          class="w-36"
        /><USelect
          v-model="priority"
          :items="priorityItems"
          size="sm"
          class="w-40"
        /><span class="grow" /><span class="mono text-muted text-xs">{{ rows.length }} / {{ total }}</span>
      </div>
      <UEmpty
        v-if="!pending && rows.length === 0"
        icon="i-lucide-ticket"
        title="暂无工单"
        description="租户提交支持请求后会显示在这里。"
        class="py-14"
      />
      <UTable
        v-else
        :data="rows"
        :columns="columns"
        :loading="pending"
        :ui="{ root: 'overflow-x-auto', th: 'text-xs font-medium text-muted bg-muted/40 whitespace-nowrap', td: 'text-sm text-muted whitespace-nowrap' }"
      >
        <template #ticket-cell="{ row }">
          <div class="max-w-96">
            <div class="font-medium text-highlighted">
              {{ row.original.title }}
            </div><div class="mono truncate text-xs text-muted">
              {{ row.original.ticketNo }}
            </div>
          </div>
        </template>
        <template #tenant-cell="{ row }">
          <div>
            <div class="font-medium text-highlighted">
              {{ row.original.tenantName || row.original.tenantCode || '平台' }}
            </div><div class="mono text-xs text-muted">
              {{ row.original.tenantCode || '—' }}
            </div>
          </div>
        </template>
        <template #category-cell="{ row }">
          {{ row.original.category }}
        </template>
        <template #priority-cell="{ row }">
          <UBadge
            :color="row.original.priority === 'urgent' ? 'error' : row.original.priority === 'high' ? 'warning' : 'neutral'"
            variant="soft"
          >
            {{ row.original.priority }}
          </UBadge>
        </template>
        <template #status-cell="{ row }">
          <UBadge
            :color="row.original.status === 'closed' ? 'neutral' : row.original.status === 'in_progress' ? 'info' : 'warning'"
            variant="soft"
          >
            {{ row.original.status }}
          </UBadge>
        </template>
        <template #assignee-cell="{ row }">
          {{ row.original.assigneeName || row.original.assigneeUid || '未分配' }}
        </template>
        <template #updatedAt-cell="{ row }">
          {{ formatDateTime(row.original.updatedAt) }}
        </template>
      </UTable>
      <div
        v-if="rows.length > 0"
        class="tbl-foot"
      >
        <span>共 <b class="font-semibold text-highlighted">{{ total }}</b> 条</span><UPagination
          v-model:page="page"
          :total="total"
          :items-per-page="pageSize"
          size="sm"
          variant="ghost"
          color="neutral"
          :show-edges="false"
        />
      </div>
    </UCard>
  </div>
</template>
