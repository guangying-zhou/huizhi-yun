<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layout: 'platform' })
usePageTitle('审计日志')

interface AuditItem { id: number, action: string, targetType: string, targetId: string, tenantCode: string | null, source: string | null, ip: string | null, operatorUid: string | null, operatorName: string | null, createdAt: string }
interface ListResponse { items: AuditItem[], total: number, page: number, pageSize: number }
interface ApiEnvelope<T> { success: true, data: T }

const q = ref('')
const page = ref(1)
const pageSize = 20
const pending = ref(false)
const error = ref<unknown>(null)
const data = ref<ApiEnvelope<ListResponse> | null>(null)
const columns: TableColumn<AuditItem>[] = [
  { id: 'action', header: '操作' },
  { id: 'target', header: '对象' },
  { id: 'operator', header: '操作人' },
  { accessorKey: 'tenantCode', header: '企业' },
  { accessorKey: 'source', header: '来源' },
  { id: 'createdAt', header: '时间' }
]
const listQuery = computed(() => ({ keyword: q.value || undefined, page: page.value, pageSize }))
const rows = computed(() => data.value?.data.items || [])
const total = computed(() => data.value?.data.total || 0)

async function refresh() {
  pending.value = true
  error.value = null
  try {
    data.value = await platformFetchJson<ApiEnvelope<ListResponse>>('/api/platform/ops/audit', { query: listQuery.value })
  } catch (caught) {
    error.value = caught
  } finally {
    pending.value = false
  }
}
function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

await refresh()
watch(q, () => {
  page.value = 1
})
watch(listQuery, () => {
  void refresh()
})
</script>

<template>
  <div>
    <div class="page-h">
      <div><h1>审计日志</h1><p>查看 Platform 管理操作的主体、对象和发生时间。</p></div><div class="page-h-actions">
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
      title="审计日志加载失败"
      :description="String((error as any)?.data?.message || (error as any)?.message || '请稍后重试')"
      class="mb-4"
    />
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="toolbar">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          placeholder="搜索操作 / 对象 / 企业 / 操作人"
          size="sm"
          class="w-full max-w-96"
        /><span class="grow" /><span class="mono text-muted text-xs">{{ rows.length }} / {{ total }}</span>
      </div>
      <UEmpty
        v-if="!pending && rows.length === 0"
        icon="i-lucide-activity"
        title="暂无审计日志"
        description="平台管理操作发生后会显示在这里。"
        class="py-14"
      />
      <UTable
        v-else
        :data="rows"
        :columns="columns"
        :loading="pending"
        :ui="{ root: 'overflow-x-auto', th: 'text-xs font-medium text-muted bg-muted/40 whitespace-nowrap', td: 'text-sm text-muted whitespace-nowrap' }"
      >
        <template #action-cell="{ row }">
          <UBadge
            color="info"
            variant="soft"
          >
            {{ row.original.action }}
          </UBadge>
        </template>
        <template #target-cell="{ row }">
          <div>
            <div class="font-medium text-highlighted">
              {{ row.original.targetType }}
            </div><div class="mono text-xs text-muted">
              {{ row.original.targetId }}
            </div>
          </div>
        </template>
        <template #operator-cell="{ row }">
          <div>
            <div>{{ row.original.operatorName || row.original.operatorUid || '系统' }}</div><div
              v-if="row.original.ip"
              class="mono text-xs text-muted"
            >
              {{ row.original.ip }}
            </div>
          </div>
        </template>
        <template #createdAt-cell="{ row }">
          {{ formatDateTime(row.original.createdAt) }}
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
