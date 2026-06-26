<script setup lang="ts">
const router = useRouter()

const QUOTE_STATUS: Record<string, { label: string, color: string }> = {
  draft: { label: '草稿', color: 'neutral' },
  pending_approval: { label: '待审批', color: 'warning' },
  approved: { label: '已批准', color: 'primary' },
  rejected: { label: '已驳回', color: 'error' },
  sent: { label: '已发送', color: 'info' },
  accepted: { label: '已接受', color: 'success' },
  expired: { label: '已失效', color: 'neutral' },
  voided: { label: '已作废', color: 'neutral' }
}

const keyword = ref('')
const statusFilter = ref<string | undefined>(undefined)
const page = ref(1)
const pageSize = ref(20)

const queryParams = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  keyword: keyword.value || undefined,
  status: statusFilter.value || undefined
}))

const { data: result, status, refresh } = useFetch('/api/v1/quotes', {
  query: queryParams,
  transform: (res: any) => res.data as { items: any[], total: number }
})

const items = computed(() => result.value?.items || [])
const total = computed(() => result.value?.total || 0)

const columns = [
  { accessorKey: 'code', header: '编号' },
  { accessorKey: 'customer_name', header: '客户' },
  { accessorKey: 'opportunity_name', header: '商机' },
  { accessorKey: 'amount_tax_inclusive', header: '报价金额' },
  { accessorKey: 'gross_margin_rate', header: '毛利率' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'valid_until', header: '有效期' },
  { accessorKey: 'owner_user_id', header: '负责人' },
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

const statusSelectOptions = computed(() =>
  Object.entries(QUOTE_STATUS).map(([v, o]) => ({ label: o.label, value: v }))
)
</script>

<template>
  <UDashboardPanel
    id="quotes"
    :ui="{
      root: '!h-full !min-h-0 !flex-1 !shrink !overflow-hidden',
      body: '!min-h-0 !flex-1 !gap-0 !overflow-hidden !p-0 sm:!p-0'
    }"
  >
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          报价管理
        </h1>
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <UButton
          label="新建报价"
          icon="i-lucide-plus"
          color="primary"
          @click="router.push('/quotes/new')"
        />
      </Teleport>

      <div class="altoc-list-page">
        <div class="altoc-list-toolbar flex flex-wrap items-center gap-2 px-4 py-3 border-b border-default">
          <UInput
            v-model="keyword"
            placeholder="搜索报价/客户..."
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
            :ui="{ thead: 'z-20 bg-default' }"
          >
            <template #code-cell="{ row }">
              <NuxtLink :to="`/quotes/${row.original.id}`" class="font-mono text-xs text-primary hover:underline">
                {{ row.original.code }}
              </NuxtLink>
            </template>
            <template #customer_name-cell="{ row }">
              <TruncatedText :text="row.original.customer_name" :max="16" />
            </template>
            <template #opportunity_name-cell="{ row }">
              {{ row.original.opportunity_name || '-' }}
            </template>
            <template #amount_tax_inclusive-cell="{ row }">
              <span class="font-mono">{{ formatMoney(row.original.amount_tax_inclusive) }}</span>
            </template>
            <template #gross_margin_rate-cell="{ row }">
              <span v-if="row.original.gross_margin_rate != null" class="font-mono">{{ row.original.gross_margin_rate }}%</span>
              <span v-else class="text-muted">--</span>
            </template>
            <template #status-cell="{ row }">
              <UBadge :color="(QUOTE_STATUS[row.original.status]?.color || 'neutral') as any" variant="subtle" size="sm">
                {{ QUOTE_STATUS[row.original.status]?.label || row.original.status }}
              </UBadge>
            </template>
            <template #valid_until-cell="{ row }">
              <span class="text-xs">{{ row.original.valid_until || '-' }}</span>
            </template>
            <template #owner_user_id-cell="{ row }">
              <UserName :uid="row.original.owner_user_id" />
            </template>
            <template #actions-cell="{ row }">
              <UButton
                icon="i-lucide-eye"
                variant="ghost"
                color="neutral"
                size="xs"
                @click="router.push(`/quotes/${row.original.id}`)"
              />
            </template>
            <template #empty>
              <div class="flex flex-col items-center py-12 text-muted">
                <UIcon name="i-lucide-calculator" class="text-4xl mb-3" />
                <p class="text-sm mb-3">
                  暂无报价数据
                </p>
                <UButton
                  label="创建第一个报价"
                  color="primary"
                  variant="soft"
                  @click="router.push('/quotes/new')"
                />
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
