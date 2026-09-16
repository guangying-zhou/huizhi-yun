<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({
  layout: 'platform'
})

usePageTitle('订单管理')

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface OrderItem {
  id: number
  orderNo: string
  tenantCode: string
  tenantName: string | null
  planCode: string
  planName: string | null
  paymentMethod: string | null
  status: string
  totalAmount: number | null
  currency: string | null
  placedAt: string
  paidAt: string | null
  effectiveFrom: string | null
  effectiveUntil: string | null
  createdByAccountId: number | null
  paymentNo: string | null
  bankTransactionNo: string | null
  confirmedByAccountId: number | null
  confirmedByUid: string | null
  confirmedByName: string | null
  confirmedAt: string | null
  notes: string | null
}

interface OrderListResponse {
  items: OrderItem[]
  total: number
  page: number
  pageSize: number
}

interface FetchLikeError {
  data?: {
    message?: string
    statusMessage?: string
  }
  message?: string
}

const toast = useToast()

const q = ref('')
const status = ref('all')
const paymentMethod = ref('all')
const page = ref(1)
const pageSize = 20
const confirmingOrderNo = ref('')
const confirmOpen = ref(false)
const selectedOrder = ref<OrderItem | null>(null)
const confirmForm = reactive({
  paidAt: '',
  bankTransactionNo: ''
})

const statusItems = [
  { label: '状态：全部', value: 'all' },
  { label: '待确认', value: 'pending' },
  { label: '已支付', value: 'paid' },
  { label: '已取消', value: 'cancelled' }
]

const paymentMethodItems = [
  { label: '支付方式：全部', value: 'all' },
  { label: '对公转账', value: 'bank_transfer' },
  { label: '微信支付', value: 'wechat_pay' },
  { label: '支付宝', value: 'alipay' }
]

const columns: TableColumn<OrderItem>[] = [
  { id: 'order', header: '订单' },
  { id: 'tenant', header: '企业' },
  { id: 'plan', header: '套餐' },
  { id: 'amount', header: '金额', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'paymentMethod', header: '支付方式' },
  { id: 'status', header: '状态' },
  { id: 'placedAt', header: '提交时间' },
  { id: 'paidAt', header: '到账/到期' },
  { id: 'actions', header: '操作', meta: { class: { th: 'text-right', td: 'text-right' } } }
]

const listQuery = computed(() => ({
  keyword: q.value || undefined,
  status: status.value,
  paymentMethod: paymentMethod.value,
  page: page.value,
  pageSize
}))

const data = ref<ApiEnvelope<OrderListResponse> | null>(null)
const pending = ref(false)
const error = ref<unknown>(null)

async function refresh() {
  pending.value = true
  error.value = null
  try {
    data.value = await platformFetchJson<ApiEnvelope<OrderListResponse>>('/api/platform/ops/subscriptions/orders', {
      query: listQuery.value
    })
  } catch (caught) {
    error.value = caught
  } finally {
    pending.value = false
  }
}

await refresh()

const rows = computed<OrderItem[]>(() => data.value?.data.items || [])
const total = computed(() => data.value?.data.total || 0)
const fetchErrorMessage = computed(() => errorMessage(error.value, '订单加载失败'))

watch([q, status, paymentMethod], () => {
  page.value = 1
})

watch(listQuery, () => {
  refresh()
})

function errorMessage(errorValue: unknown, fallback: string) {
  const err = errorValue as FetchLikeError | null
  return err?.data?.message || err?.data?.statusMessage || err?.message || fallback
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatAmount(order: OrderItem) {
  if (order.totalAmount === null || order.totalAmount === undefined) return '面议'
  const currency = order.currency === 'CNY' || !order.currency ? '¥' : `${order.currency} `
  return `${currency}${Number(order.totalAmount).toLocaleString()}`
}

function formatPaymentMethod(method: string | null) {
  if (method === 'bank_transfer') return '对公转账'
  if (method === 'wechat_pay') return '微信支付'
  if (method === 'alipay') return '支付宝'
  return method || '—'
}

function toDatetimeLocal(value: Date) {
  const offset = value.getTimezoneOffset()
  const local = new Date(value.getTime() - offset * 60_000)
  return local.toISOString().slice(0, 16)
}

function openConfirmOrder(order: OrderItem) {
  selectedOrder.value = order
  confirmForm.paidAt = toDatetimeLocal(new Date())
  confirmForm.bankTransactionNo = ''
  confirmOpen.value = true
}

async function submitConfirmOrder() {
  const order = selectedOrder.value
  if (!order) return

  if (!confirmForm.paidAt || !confirmForm.bankTransactionNo.trim()) {
    toast.add({
      title: '请补齐到账信息',
      description: '到账日期和银行流水号都不能为空。',
      color: 'warning'
    })
    return
  }

  confirmingOrderNo.value = order.orderNo
  try {
    await platformFetchJson<ApiEnvelope<{ orderNo: string, subscriptionId?: number }>>(
      `/api/platform/ops/subscriptions/orders/${encodeURIComponent(order.orderNo)}/confirm`,
      {
        method: 'POST',
        body: {
          paidAt: confirmForm.paidAt,
          bankTransactionNo: confirmForm.bankTransactionNo.trim()
        }
      }
    )
    confirmOpen.value = false
    toast.add({
      title: '已确认到账',
      description: `${order.orderNo} 已激活企业套餐。`,
      color: 'success'
    })
    await refresh()
  } catch (caught) {
    toast.add({
      title: '确认失败',
      description: errorMessage(caught, '请检查订单状态后重试'),
      color: 'error'
    })
  } finally {
    confirmingOrderNo.value = ''
  }
}
</script>

<template>
  <div>
    <div class="page-h">
      <div>
        <h1>订单管理</h1>
        <p>查看租户订阅订单。对公转账订单确认到账后，租户主订阅会按到账日期激活并进入30天试用期。</p>
      </div>
      <div class="page-h-actions">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="pending"
          @click="() => refresh()"
        >
          刷新
        </UButton>
      </div>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      :title="fetchErrorMessage"
      class="mb-4"
    />

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="toolbar">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          placeholder="搜索订单号 / 企业 / 套餐"
          size="sm"
          class="w-full max-w-80"
        />
        <USelect
          v-model="status"
          :items="statusItems"
          size="sm"
          class="w-36"
        />
        <USelect
          v-model="paymentMethod"
          :items="paymentMethodItems"
          size="sm"
          class="w-40"
        />
        <span class="grow" />
        <span class="mono text-muted text-xs">
          {{ rows.length }} / {{ total }}
        </span>
      </div>

      <UEmpty
        v-if="!pending && rows.length === 0"
        icon="i-lucide-receipt-text"
        title="暂无订单"
        description="企业提交订阅后，会在这里生成订单记录。"
        class="py-14"
      />

      <UTable
        v-else
        :data="rows"
        :columns="columns"
        :loading="pending"
        :ui="{
          root: 'overflow-x-auto',
          th: 'text-xs font-medium uppercase tracking-[0.04em] text-muted bg-muted/40 whitespace-nowrap',
          td: 'text-sm text-muted whitespace-nowrap'
        }"
      >
        <template #order-cell="{ row }">
          <div>
            <div class="font-medium text-highlighted">
              {{ row.original.orderNo }}
            </div>
            <div class="text-xs text-muted">
              {{ row.original.paymentNo || row.original.paymentMethod || '—' }}
            </div>
          </div>
        </template>

        <template #tenant-cell="{ row }">
          <div>
            <div class="font-medium text-highlighted">
              {{ row.original.tenantName || row.original.tenantCode }}
            </div>
            <div class="mono text-xs text-muted">
              {{ row.original.tenantCode }}
            </div>
          </div>
        </template>

        <template #plan-cell="{ row }">
          <div>
            <div class="font-medium text-highlighted">
              {{ row.original.planName || row.original.planCode }}
            </div>
            <div class="mono text-xs text-muted">
              {{ row.original.planCode }}
            </div>
          </div>
        </template>

        <template #amount-cell="{ row }">
          <span class="font-medium text-highlighted">{{ formatAmount(row.original) }}</span>
        </template>

        <template #paymentMethod-cell="{ row }">
          <UBadge
            :color="row.original.paymentMethod === 'bank_transfer' ? 'warning' : 'info'"
            variant="soft"
          >
            {{ formatPaymentMethod(row.original.paymentMethod) }}
          </UBadge>
        </template>

        <template #status-cell="{ row }">
          <UBadge
            :color="row.original.status === 'pending' ? 'warning' : row.original.status === 'paid' ? 'success' : 'neutral'"
            variant="soft"
          >
            {{ row.original.status }}
          </UBadge>
        </template>

        <template #placedAt-cell="{ row }">
          {{ formatDateTime(row.original.placedAt) }}
        </template>

        <template #paidAt-cell="{ row }">
          <div>
            <div class="text-highlighted">
              {{ formatDateTime(row.original.paidAt) }}
            </div>
            <div class="text-xs text-muted">
              {{ row.original.effectiveUntil ? `到期 ${formatDateTime(row.original.effectiveUntil)}` : '—' }}
            </div>
          </div>
        </template>

        <template #actions-cell="{ row }">
          <UButton
            v-if="row.original.status === 'pending' && row.original.paymentMethod === 'bank_transfer'"
            size="sm"
            color="primary"
            variant="soft"
            icon="i-lucide-badge-check"
            :loading="confirmingOrderNo === row.original.orderNo"
            @click="openConfirmOrder(row.original)"
          >
            确认到账
          </UButton>
          <span
            v-else-if="row.original.status === 'paid'"
            class="text-xs text-muted"
          >
            {{ row.original.confirmedByName || row.original.confirmedByUid || '自动确认' }}
          </span>
          <span
            v-else
            class="text-xs text-muted"
          >
            —
          </span>
        </template>
      </UTable>

      <div
        v-if="rows.length > 0"
        class="tbl-foot"
      >
        <span>共 <b class="font-semibold text-highlighted">{{ total }}</b> 条</span>
        <UPagination
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

    <UModal
      v-model:open="confirmOpen"
      title="确认对公转账到账"
      :ui="{ content: 'max-w-lg', footer: 'flex justify-end gap-2' }"
    >
      <template #body>
        <div
          v-if="selectedOrder"
          class="space-y-4"
        >
          <UAlert
            color="warning"
            variant="soft"
            title="确认后将激活租户订阅"
            :description="`订单 ${selectedOrder.orderNo} 将从到账日期开始计算30天试用期。`"
          />

          <div class="rounded-lg border border-default bg-muted/30 p-4 text-sm">
            <div class="flex items-center justify-between gap-4">
              <span class="text-muted">企业</span>
              <span class="font-medium text-highlighted">{{ selectedOrder.tenantName || selectedOrder.tenantCode }}</span>
            </div>
            <div class="mt-2 flex items-center justify-between gap-4">
              <span class="text-muted">套餐</span>
              <span class="font-medium text-highlighted">{{ selectedOrder.planName || selectedOrder.planCode }}</span>
            </div>
            <div class="mt-2 flex items-center justify-between gap-4">
              <span class="text-muted">金额</span>
              <span class="font-medium text-highlighted">{{ formatAmount(selectedOrder) }}</span>
            </div>
          </div>

          <UFormField
            label="到账日期"
            required
          >
            <UInput
              v-model="confirmForm.paidAt"
              type="datetime-local"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="银行流水号"
            required
          >
            <UInput
              v-model="confirmForm.bankTransactionNo"
              class="w-full"
              placeholder="输入银行回单或流水号"
            />
          </UFormField>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="Boolean(confirmingOrderNo)"
          @click="confirmOpen = false"
        >
          取消
        </UButton>
        <UButton
          color="primary"
          icon="i-lucide-badge-check"
          :loading="Boolean(confirmingOrderNo)"
          @click="submitConfirmOrder"
        >
          确认到账
        </UButton>
      </template>
    </UModal>
  </div>
</template>
