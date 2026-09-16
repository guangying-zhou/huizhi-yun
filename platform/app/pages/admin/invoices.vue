<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layout: 'platform' })
usePageTitle('发票管理')

interface InvoiceItem {
  id: number
  invoiceNo: string
  orderNo: string
  tenantCode: string
  tenantName: string | null
  amount: number
  currency: string
  status: string
  issuedAt: string
  paidAt: string | null
}

interface ListResponse { items: InvoiceItem[], total: number, page: number, pageSize: number }
interface ApiEnvelope<T> { success: true, data: T }

const q = ref('')
const status = ref('all')
const page = ref(1)
const pageSize = 20
const pending = ref(false)
const error = ref<unknown>(null)
const data = ref<ApiEnvelope<ListResponse> | null>(null)
const statusItems = [
  { label: '状态：全部', value: 'all' },
  { label: '已开具', value: 'issued' },
  { label: '已支付', value: 'paid' },
  { label: '已作废', value: 'void' }
]
const columns: TableColumn<InvoiceItem>[] = [
  { id: 'invoice', header: '发票' },
  { id: 'tenant', header: '企业' },
  { id: 'amount', header: '金额' },
  { id: 'status', header: '状态' },
  { id: 'issuedAt', header: '开具时间' },
  { id: 'paidAt', header: '支付时间' }
]
const listQuery = computed(() => ({ keyword: q.value || undefined, status: status.value, page: page.value, pageSize }))
const rows = computed(() => data.value?.data.items || [])
const total = computed(() => data.value?.data.total || 0)

async function refresh() {
  pending.value = true
  error.value = null
  try {
    data.value = await platformFetchJson<ApiEnvelope<ListResponse>>('/api/platform/ops/invoices', { query: listQuery.value })
  } catch (caught) {
    error.value = caught
  } finally {
    pending.value = false
  }
}

function formatAmount(item: InvoiceItem) {
  return `${item.currency === 'CNY' ? '¥' : `${item.currency} `}${Number(item.amount).toLocaleString()}`
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
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
      <div>
        <h1>发票管理</h1>
        <p>查看平台订阅订单生成的发票、金额和支付状态。</p>
      </div>
      <div class="page-h-actions">
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
      title="发票加载失败"
      :description="String((error as any)?.data?.message || (error as any)?.message || '请稍后重试')"
      class="mb-4"
    />
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="toolbar">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          placeholder="搜索发票号 / 订单号 / 企业"
          size="sm"
          class="w-full max-w-80"
        />
        <USelect
          v-model="status"
          :items="statusItems"
          size="sm"
          class="w-36"
        />
        <span class="grow" />
        <span class="mono text-muted text-xs">{{ rows.length }} / {{ total }}</span>
      </div>
      <UEmpty
        v-if="!pending && rows.length === 0"
        icon="i-lucide-file-text"
        title="暂无发票"
        description="订阅订单开具发票后会显示在这里。"
        class="py-14"
      />
      <UTable
        v-else
        :data="rows"
        :columns="columns"
        :loading="pending"
        :ui="{ root: 'overflow-x-auto', th: 'text-xs font-medium text-muted bg-muted/40 whitespace-nowrap', td: 'text-sm text-muted whitespace-nowrap' }"
      >
        <template #invoice-cell="{ row }">
          <div>
            <div class="font-medium text-highlighted">
              {{ row.original.invoiceNo }}
            </div><div class="mono text-xs text-muted">
              {{ row.original.orderNo }}
            </div>
          </div>
        </template>
        <template #tenant-cell="{ row }">
          <div>
            <div class="font-medium text-highlighted">
              {{ row.original.tenantName || row.original.tenantCode }}
            </div><div class="mono text-xs text-muted">
              {{ row.original.tenantCode }}
            </div>
          </div>
        </template>
        <template #amount-cell="{ row }">
          <span class="font-medium text-highlighted">{{ formatAmount(row.original) }}</span>
        </template>
        <template #status-cell="{ row }">
          <UBadge
            :color="row.original.status === 'paid' ? 'success' : row.original.status === 'void' ? 'neutral' : 'info'"
            variant="soft"
          >
            {{ row.original.status }}
          </UBadge>
        </template>
        <template #issuedAt-cell="{ row }">
          {{ formatDateTime(row.original.issuedAt) }}
        </template>
        <template #paidAt-cell="{ row }">
          {{ formatDateTime(row.original.paidAt) }}
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
