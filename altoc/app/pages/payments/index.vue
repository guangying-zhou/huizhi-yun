<script setup lang="ts">
const router = useRouter()

const RP_STATUS: Record<string, { label: string, color: string }> = {
  pending: { label: '待开始', color: 'neutral' },
  to_invoice: { label: '待开票', color: 'warning' },
  to_receive: { label: '待回款', color: 'primary' },
  partially_received: { label: '部分回款', color: 'info' },
  received: { label: '已回款', color: 'success' },
  overdue: { label: '已逾期', color: 'error' },
  bad_debt: { label: '坏账', color: 'error' }
}

const keyword = ref('')
const statusFilter = ref<string | undefined>(undefined)
const page = ref(1)
const pageSize = ref(20)

const queryParams = computed(() => ({
  page: page.value, pageSize: pageSize.value,
  keyword: keyword.value || undefined,
  status: statusFilter.value || undefined
}))

const { data: result, status, refresh } = useFetch('/api/v1/payments', {
  query: queryParams,
  transform: (res: any) => res.data as { items: any[], total: number }
})

const items = computed(() => result.value?.items || [])
const total = computed(() => result.value?.total || 0)

const columns = [
  { accessorKey: 'code', header: '编号' },
  { accessorKey: 'customer_name', header: '客户' },
  { accessorKey: 'contract_name', header: '合同' },
  { accessorKey: 'plan_name', header: '回款节点' },
  { accessorKey: 'amount', header: '计划金额' },
  { accessorKey: 'received_amount', header: '已回款' },
  { accessorKey: 'unreceived_amount', header: '未回款' },
  { accessorKey: 'planned_payment_date', header: '计划日期' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'actions', header: '' }
]

function onSearch() {
  page.value = 1
  refresh()
}

function resetFilters() {
  keyword.value = ''
  statusFilter.value = undefined
  page.value = 1
}
function formatMoney(val: number | null) {
  if (val == null) return '--'
  return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 0 }).format(val)
}

// 是否逾期（计划日期已过且未完成）
function isOverdue(item: any) {
  if (item.status === 'received' || item.status === 'overdue' || item.status === 'bad_debt') return false
  if (!item.planned_payment_date) return false
  return new Date(item.planned_payment_date) < new Date()
}

const statusSelectOptions = computed(() =>
  Object.entries(RP_STATUS).map(([v, o]) => ({ label: o.label, value: v }))
)
</script>

<template>
  <UDashboardPanel
    id="payments"
    :ui="{
      root: '!h-full !min-h-0 !flex-1 !shrink !overflow-hidden',
      body: '!min-h-0 !flex-1 !gap-0 !overflow-hidden !p-0 sm:!p-0'
    }"
  >
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          回款管理
        </h1>
      </Teleport>

      <div class="altoc-list-page min-w-0">
        <div class="altoc-list-toolbar flex flex-wrap items-center gap-2 px-4 py-3 border-b border-default">
          <UInput
            v-model="keyword"
            placeholder="搜索回款/客户/合同..."
            icon="i-lucide-search"
            class="w-56"
            @keyup.enter="onSearch"
          />
          <USelect
            v-model="statusFilter"
            :items="statusSelectOptions"
            placeholder="全部状态"
            class="w-32"
            @update:model-value="onSearch"
          />
          <UButton
            label="重置"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="resetFilters"
          />
        </div>

        <div class="altoc-list-table">
          <UTable
            :data="items"
            :columns="columns"
            :loading="status === 'pending'"
            sticky="header"
            class="altoc-sticky-table w-full"
            :ui="{ base: 'w-full min-w-[1040px]', thead: 'z-20 bg-default' }"
          >
            <template #code-cell="{ row }">
              <NuxtLink :to="`/payments/${row.original.id}`" class="font-mono text-xs text-primary hover:underline">
                {{ row.original.code }}
              </NuxtLink>
            </template>
            <template #customer_name-cell="{ row }">
              <TruncatedText :text="row.original.customer_name" :max="16" />
            </template>
            <template #contract_name-cell="{ row }">
              <NuxtLink v-if="row.original.contract_id" :to="`/contracts/${row.original.contract_id}`" class="text-primary hover:underline text-sm">
                <TruncatedText :text="row.original.contract_name || row.original.contract_code" :max="16" />
              </NuxtLink>
            </template>
            <template #amount-cell="{ row }">
              <span class="font-mono">{{ formatMoney(row.original.amount) }}</span>
            </template>
            <template #received_amount-cell="{ row }">
              <span class="font-mono text-success">{{ formatMoney(row.original.received_amount) }}</span>
            </template>
            <template #unreceived_amount-cell="{ row }">
              <span class="font-mono" :class="row.original.unreceived_amount > 0 ? 'text-warning' : ''">{{ formatMoney(row.original.unreceived_amount) }}</span>
            </template>
            <template #planned_payment_date-cell="{ row }">
              <span class="text-xs" :class="isOverdue(row.original) ? 'text-error font-medium' : ''">
                {{ row.original.planned_payment_date || '-' }}
                <span v-if="isOverdue(row.original)" class="ml-1">(逾期)</span>
              </span>
            </template>
            <template #status-cell="{ row }">
              <UBadge :color="(RP_STATUS[row.original.status]?.color || 'neutral') as any" variant="subtle" size="sm">
                {{ RP_STATUS[row.original.status]?.label || row.original.status }}
              </UBadge>
            </template>
            <template #actions-cell="{ row }">
              <UButton
                icon="i-lucide-eye"
                variant="ghost"
                color="neutral"
                size="xs"
                @click="router.push(`/payments/${row.original.id}`)"
              />
            </template>
            <template #empty>
              <div class="flex flex-col items-center py-12 text-muted">
                <UIcon name="i-lucide-wallet" class="text-4xl mb-3" />
                <p class="text-sm">
                  暂无回款数据
                </p>
                <p class="text-xs mt-1">
                  合同生效后将自动生成回款计划
                </p>
              </div>
            </template>
          </UTable>
        </div>

        <div v-if="total > 0" class="altoc-list-pagination flex items-center justify-between px-4 py-3 border-t border-default">
          <span class="text-sm text-muted">共 {{ total }} 条</span>
          <UPagination v-model:page="page" :items-per-page="pageSize" :total="total" />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
