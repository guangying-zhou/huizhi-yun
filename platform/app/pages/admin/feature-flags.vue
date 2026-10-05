<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layout: 'platform' })
usePageTitle('Feature Flag')

interface FlagItem { id: number, flagCode: string, flagName: string, description: string | null, defaultValue: unknown, status: string, assignmentCount: number, updatedAt: string }
interface ListResponse { items: FlagItem[], total: number, page: number, pageSize: number }
interface ApiEnvelope<T> { success: true, data: T }

const q = ref('')
const status = ref('all')
const page = ref(1)
const pageSize = 20
const pending = ref(false)
const error = ref<unknown>(null)
const data = ref<ApiEnvelope<ListResponse> | null>(null)
const statusItems = [{ label: '状态：全部', value: 'all' }, { label: '启用', value: 'active' }, { label: '停用', value: 'disabled' }]
const columns: TableColumn<FlagItem>[] = [
  { id: 'flag', header: '功能开关' },
  { id: 'defaultValue', header: '默认值' },
  { accessorKey: 'assignmentCount', header: '定向规则' },
  { id: 'updatedAt', header: '更新时间' },
  { id: 'status', header: '状态' }
]
const listQuery = computed(() => ({ keyword: q.value || undefined, status: status.value, page: page.value, pageSize }))
const rows = computed(() => data.value?.data.items || [])
const total = computed(() => data.value?.data.total || 0)

async function refresh() {
  pending.value = true
  error.value = null
  try {
    data.value = await platformFetchJson<ApiEnvelope<ListResponse>>('/api/platform/ops/feature-flags', { query: listQuery.value })
  } catch (caught) {
    error.value = caught
  } finally {
    pending.value = false
  }
}
function displayValue(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

await refresh()
watch([q, status], () => {
  page.value = 1
})
watch(listQuery, () => {
  void refresh()
})
</script>

<template>
  <div>
    <div class="page-h">
      <div><h1>Feature Flag</h1><p>查看平台功能开关、默认值和定向规则数量。</p></div><div class="page-h-actions">
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
      title="Feature Flag 加载失败"
      :description="String((error as any)?.data?.message || (error as any)?.message || '请稍后重试')"
      class="mb-4"
    />
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="toolbar">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          placeholder="搜索开关编码 / 名称"
          size="sm"
          class="w-full max-w-80"
        /><USelect
          v-model="status"
          :items="statusItems"
          size="sm"
          class="w-36"
        /><span class="grow" /><span class="mono text-muted text-xs">{{ rows.length }} / {{ total }}</span>
      </div>
      <UEmpty
        v-if="!pending && rows.length === 0"
        icon="i-lucide-flag"
        title="暂无 Feature Flag"
        description="功能开关创建后会显示在这里。"
        class="py-14"
      />
      <UTable
        v-else
        :data="rows"
        :columns="columns"
        :loading="pending"
        :ui="{ root: 'overflow-x-auto', th: 'text-xs font-medium text-muted bg-muted/40 whitespace-nowrap', td: 'text-sm text-muted whitespace-nowrap' }"
      >
        <template #flag-cell="{ row }">
          <div>
            <div class="font-medium text-highlighted">
              {{ row.original.flagName }}
            </div><div class="mono text-xs text-muted">
              {{ row.original.flagCode }}
            </div><div
              v-if="row.original.description"
              class="text-xs text-muted"
            >
              {{ row.original.description }}
            </div>
          </div>
        </template>
        <template #defaultValue-cell="{ row }">
          <code class="text-xs">{{ displayValue(row.original.defaultValue) }}</code>
        </template>
        <template #updatedAt-cell="{ row }">
          {{ formatDateTime(row.original.updatedAt) }}
        </template>
        <template #status-cell="{ row }">
          <UBadge
            :color="row.original.status === 'active' ? 'success' : 'neutral'"
            variant="soft"
          >
            {{ row.original.status }}
          </UBadge>
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
