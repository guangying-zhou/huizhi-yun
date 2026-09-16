<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layout: 'platform' })
usePageTitle('付款管理')

interface PaymentItem {
  id: number
  paymentNo: string
  orderNo: string
  invoiceNo: string | null
  tenantCode: string
  tenantName: string | null
  amount: number
  currency: string
  method: string
  status: string
  transactionRef: string | null
  paidAt: string
  confirmedAt: string | null
  confirmedByUid: string | null
  confirmedByName: string | null
}
interface ListResponse { items: PaymentItem[], total: number, page: number, pageSize: number }
interface ApiEnvelope<T> { success: true, data: T }

const q = ref('')
const status = ref('all')
const method = ref('all')
const page = ref(1)
const pageSize = 20
const pending = ref(false)
const error = ref<unknown>(null)
const data = ref<ApiEnvelope<ListResponse> | null>(null)
const statusItems = [{ label: '状态：全部', value: 'all' }, { label: '成功', value: 'succeeded' }, { label: '处理中', value: 'pending' }, { label: '失败', value: 'failed' }]
const methodItems = [{ label: '方式：全部', value: 'all' }, { label: '对公转账', value: 'bank_transfer' }, { label: '微信支付', value: 'wechat_pay' }, { label: '支付宝', value: 'alipay' }]
const columns: TableColumn<PaymentItem>[] = [
  { id: 'payment', header: '付款' }, { id: 'tenant', header: '企业' }, { id: 'amount', header: '金额' },
  { id: 'method', header: '方式' }, { id: 'status', header: '状态' }, { id: 'paidAt', header: '支付时间' }, { id: 'confirmedBy', header: '确认人' }
]
const listQuery = computed(() => ({ keyword: q.value || undefined, status: status.value, method: method.value, page: page.value, pageSize }))
const rows = computed(() => data.value?.data.items || [])
const total = computed(() => data.value?.data.total || 0)

async function refresh() {
  pending.value = true
  error.value = null
  try {
    data.value = await platformFetchJson<ApiEnvelope<ListResponse>>('/api/platform/ops/payments', { query: listQuery.value })
  } catch (caught) {
    error.value = caught
  } finally {
    pending.value = false
  }
}
function formatAmount(item: PaymentItem) {
  return `${item.currency === 'CNY' ? '¥' : `${item.currency} `}${Number(item.amount).toLocaleString()}`
}
function formatDateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

await refresh()
watch([q, status, method], () => {
  page.value = 1
})
watch(listQuery, () => {
  void refresh()
})
</script>

<template>
  <div>
    <div class="page-h">
      <div><h1>付款管理</h1><p>查看平台订阅收款记录、支付渠道和人工确认信息。</p></div><div class="page-h-actions">
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
      title="付款记录加载失败"
      :description="String((error as any)?.data?.message || (error as any)?.message || '请稍后重试')"
      class="mb-4"
    />
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="toolbar">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          placeholder="搜索付款号 / 流水号 / 订单 / 企业"
          size="sm"
          class="w-full max-w-80"
        /><USelect
          v-model="status"
          :items="statusItems"
          size="sm"
          class="w-36"
        /><USelect
          v-model="method"
          :items="methodItems"
          size="sm"
          class="w-40"
        /><span class="grow" /><span class="mono text-muted text-xs">{{ rows.length }} / {{ total }}</span>
      </div>
      <UEmpty
        v-if="!pending && rows.length === 0"
        icon="i-lucide-credit-card"
        title="暂无付款记录"
        description="订阅订单到账后会显示在这里。"
        class="py-14"
      />
      <UTable
        v-else
        :data="rows"
        :columns="columns"
        :loading="pending"
        :ui="{ root: 'overflow-x-auto', th: 'text-xs font-medium text-muted bg-muted/40 whitespace-nowrap', td: 'text-sm text-muted whitespace-nowrap' }"
      >
        <template #payment-cell="{ row }">
          <div>
            <div class="font-medium text-highlighted">
              {{ row.original.paymentNo }}
            </div><div class="mono text-xs text-muted">
              {{ row.original.transactionRef || row.original.orderNo }}
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
        <template #method-cell="{ row }">
          <UBadge
            color="info"
            variant="soft"
          >
            {{ row.original.method }}
          </UBadge>
        </template>
        <template #status-cell="{ row }">
          <UBadge
            :color="row.original.status === 'succeeded' ? 'success' : row.original.status === 'failed' ? 'error' : 'warning'"
            variant="soft"
          >
            {{ row.original.status }}
          </UBadge>
        </template>
        <template #paidAt-cell="{ row }">
          {{ formatDateTime(row.original.paidAt) }}
        </template>
        <template #confirmedBy-cell="{ row }">
          {{ row.original.confirmedByName || row.original.confirmedByUid || '自动确认' }}
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
