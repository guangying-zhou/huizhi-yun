<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { SortingState } from '@tanstack/vue-table'

const router = useRouter()
const UButton = resolveComponent('UButton')

const CONTRACT_STATUS: Record<string, { label: string, color: string }> = {
  draft: { label: '草稿', color: 'neutral' },
  pending_approval: { label: '审批中', color: 'warning' },
  approved: { label: '待生效', color: 'primary' },
  effective: { label: '履约中', color: 'success' },
  completed: { label: '已完成', color: 'success' },
  terminated: { label: '已终止', color: 'error' },
  invalid: { label: '无效', color: 'neutral' }
}

const LEGACY_CONTRACT_STATUS: Record<string, string> = {
  rejected: 'draft',
  executing: 'effective',
  delivering: 'effective',
  accepted: 'effective',
  service_ended: 'effective',
  expired: 'effective'
}

function normalizeContractStatus(status: string | null | undefined) {
  const value = String(status || '')
  return LEGACY_CONTRACT_STATUS[value] || value
}

function contractStatusMeta(status: string | null | undefined) {
  const normalized = normalizeContractStatus(status)
  return CONTRACT_STATUS[normalized] || { label: status || '-', color: 'neutral' }
}

interface ContractListFilterState {
  keyword?: string
  status?: string
  metricFilters?: ContractMetricFilter[]
}

type ContractMetricFilter = 'unreceived' | 'invoice_balance' | 'receivable_uncollected'
type ContractListRow = Record<string, any>
type ContractSortColumn = typeof CONTRACT_SORT_COLUMNS[number]

const CONTRACT_SORT_COLUMNS = [
  'code',
  'name',
  'customer_name',
  'amount_tax_inclusive',
  'receivable_uncollected_amount',
  'unreceived_amount',
  'invoice_balance',
  'status',
  'sign_date',
  'end_date',
  'owner_user_id'
] as const

const METRIC_FILTER_LABELS: Record<ContractMetricFilter, string> = {
  unreceived: '未回款额非零',
  invoice_balance: '发票余额非零',
  receivable_uncollected: '应收未收非零'
}

const sorting = ref<SortingState>([
  { id: 'sign_date', desc: true }
])
const tableSortingOptions = { manualSorting: true }

function isContractSortColumn(value: string): value is ContractSortColumn {
  return CONTRACT_SORT_COLUMNS.includes(value as ContractSortColumn)
}

const activeSort = computed(() => sorting.value[0])
const activeSortColumn = computed<ContractSortColumn>(() => {
  const column = String(activeSort.value?.id || '')
  return isContractSortColumn(column) ? column : 'sign_date'
})
const activeSortOrder = computed(() => activeSort.value?.desc === false ? 'asc' : 'desc')

function sortableHeader(label: string) {
  return ({ column }: { column: any }) => {
    const isSorted = column.getIsSorted()
    return h(UButton, {
      'color': 'neutral',
      'variant': 'ghost',
      label,
      'icon': isSorted
        ? isSorted === 'asc'
          ? 'i-lucide-arrow-up-narrow-wide'
          : 'i-lucide-arrow-down-wide-narrow'
        : 'i-lucide-arrow-up-down',
      'class': '-mx-2.5',
      'aria-label': `按${label}${isSorted === 'asc' ? '降序' : '升序'}排序`,
      'onClick': () => column.toggleSorting(column.getIsSorted() === 'asc')
    })
  }
}

const savedFilterState = useCookie<ContractListFilterState>('altoc_contract_list_filters', {
  path: '/',
  sameSite: 'lax',
  default: () => ({})
})

function savedStatus(value: string | undefined) {
  return value && CONTRACT_STATUS[value] ? value : undefined
}

function savedMetricFilters(values: ContractMetricFilter[] | undefined) {
  return Array.isArray(values)
    ? values.filter((value): value is ContractMetricFilter => value in METRIC_FILTER_LABELS)
    : []
}

const keyword = ref(savedFilterState.value.keyword || '')
const statusFilter = ref<string | undefined>(savedStatus(savedFilterState.value.status))
const activeMetricFilters = ref<ContractMetricFilter[]>(savedMetricFilters(savedFilterState.value.metricFilters))
const page = ref(1)
const pageSize = ref(20)

const queryParams = computed(() => ({
  page: page.value, pageSize: pageSize.value,
  keyword: keyword.value || undefined,
  status: statusFilter.value || undefined,
  unreceived_nonzero: activeMetricFilters.value.includes('unreceived') ? '1' : undefined,
  invoice_balance_nonzero: activeMetricFilters.value.includes('invoice_balance') ? '1' : undefined,
  receivable_uncollected_nonzero: activeMetricFilters.value.includes('receivable_uncollected') ? '1' : undefined,
  sort: activeSortColumn.value,
  order: activeSortOrder.value
}))

const { data: result, status, refresh } = useFetch('/api/v1/contracts', {
  query: queryParams,
  transform: (res: any) => res.data as {
    items: any[]
    total: number
    summary?: {
      contract_count: number
      contract_amount: string
      unreceived_amount: string
      invoice_balance: string
      receivable_uncollected_amount: string
    }
  }
})

const items = computed(() => result.value?.items || [])
const total = computed(() => result.value?.total || 0)
const summary = computed(() => result.value?.summary || {
  contract_count: 0,
  contract_amount: '0',
  unreceived_amount: '0',
  invoice_balance: '0',
  receivable_uncollected_amount: '0'
})

const columns: TableColumn<ContractListRow>[] = [
  { accessorKey: 'code', header: sortableHeader('编号') },
  { accessorKey: 'name', header: sortableHeader('合同名称') },
  { accessorKey: 'customer_name', header: sortableHeader('客户') },
  { accessorKey: 'amount_tax_inclusive', header: sortableHeader('合同金额') },
  { accessorKey: 'receivable_uncollected_amount', header: sortableHeader('应收未收') },
  { accessorKey: 'unreceived_amount', header: sortableHeader('未回款额') },
  { accessorKey: 'invoice_balance', header: sortableHeader('发票余额') },
  { accessorKey: 'status', header: sortableHeader('状态') },
  { accessorKey: 'sign_date', header: sortableHeader('签约日期') },
  { accessorKey: 'end_date', header: sortableHeader('到期日期') },
  { accessorKey: 'owner_user_id', header: sortableHeader('负责人') },
  { accessorKey: 'actions', header: '', enableSorting: false }
]

function onSearch() {
  keyword.value = keyword.value.trim()
  page.value = 1
  refresh()
}
function resetFilters() {
  keyword.value = ''
  statusFilter.value = undefined
  activeMetricFilters.value = []
  page.value = 1
}
function formatMoney(val: number | string | null | undefined) {
  if (val == null) return '--'
  return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 0 }).format(Number(val) || 0)
}

function formatCount(val: number | string | null | undefined) {
  return new Intl.NumberFormat('zh-CN').format(Number(val) || 0)
}

const statusSelectOptions = computed(() =>
  Object.entries(CONTRACT_STATUS).map(([v, o]) => ({ label: o.label, value: v }))
)

const currentStatusFilterLabel = computed(() => (
  statusFilter.value ? contractStatusMeta(statusFilter.value).label : '全部'
))

function hasMetricFilter(filter: ContractMetricFilter) {
  return activeMetricFilters.value.includes(filter)
}

function toggleMetricFilter(filter: ContractMetricFilter) {
  activeMetricFilters.value = hasMetricFilter(filter)
    ? activeMetricFilters.value.filter(value => value !== filter)
    : [...activeMetricFilters.value, filter]
  page.value = 1
}

function metricCardClass(filter: ContractMetricFilter) {
  return hasMetricFilter(filter)
    ? 'border-primary bg-primary/5 shadow-sm'
    : 'border-default hover:border-primary/60 hover:bg-muted/40'
}

const scanPreviewOpen = ref(false)
const scanPreviewUrl = ref('')
const scanPreviewTitle = ref('')

function contractScanUrl(row: any) {
  return String(row?.contract_scan_url || '').trim()
}

function hasContractScan(row: any) {
  return !!contractScanUrl(row)
}

function openContractScan(row: any) {
  const url = contractScanUrl(row)
  if (!url) return
  scanPreviewUrl.value = url
  scanPreviewTitle.value = String(row?.contract_scan_title || row?.name || '合同扫描件')
  scanPreviewOpen.value = true
}

function openContractScanExternal() {
  if (!scanPreviewUrl.value) return
  window.open(scanPreviewUrl.value, '_blank', 'noopener,noreferrer')
}

watch([keyword, statusFilter, activeMetricFilters], ([nextKeyword, nextStatus, nextMetricFilters]) => {
  savedFilterState.value = {
    keyword: nextKeyword.trim() || undefined,
    status: nextStatus || undefined,
    metricFilters: nextMetricFilters.length ? nextMetricFilters : undefined
  }
})

watch(sorting, () => {
  page.value = 1
}, { deep: true })
</script>

<template>
  <UDashboardPanel
    id="contracts"
    :ui="{
      root: '!h-full !min-h-0 !flex-1 !shrink !overflow-hidden',
      body: '!min-h-0 !flex-1 !gap-0 !overflow-hidden !p-0 sm:!p-0'
    }"
  >
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          合同管理
        </h1>
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <UButton
          label="新建合同"
          icon="i-lucide-plus"
          color="primary"
          @click="router.push('/contracts/new')"
        />
      </Teleport>

      <div class="altoc-list-page min-w-0">
        <div class="altoc-list-toolbar flex flex-wrap items-center gap-2 px-4 py-3 border-b border-default">
          <UInput
            v-model="keyword"
            placeholder="搜索合同/客户..."
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

        <div class="altoc-list-summary grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-6 gap-3 px-4 py-3 border-b border-default">
          <div class="rounded-md border border-default p-3">
            <div class="text-xs text-muted">
              合同状态
            </div>
            <div class="mt-1 text-xl font-bold font-mono text-secondary">
              {{ currentStatusFilterLabel }}
            </div>
          </div>
          <div class="rounded-md border border-default p-3">
            <div class="text-xs text-muted">
              合同数
            </div>
            <div class="mt-1 text-xl font-bold font-mono">
              {{ formatCount(summary.contract_count) }}
            </div>
          </div>
          <div class="rounded-md border border-default p-3">
            <div class="text-xs text-muted">
              总合同额
            </div>
            <div class="mt-1 text-xl font-bold font-mono text-success">
              {{ formatMoney(summary.contract_amount) }}
            </div>
          </div>
          <button
            type="button"
            class="relative rounded-md border p-3 text-left transition-colors pr-10"
            :class="metricCardClass('unreceived')"
            :aria-pressed="hasMetricFilter('unreceived')"
            @click="toggleMetricFilter('unreceived')"
          >
            <UIcon
              v-if="hasMetricFilter('unreceived')"
              name="i-lucide-filter"
              class="absolute right-3 top-3 size-4 text-primary"
            />
            <div class="text-xs text-muted">
              未回款额
            </div>
            <div class="mt-1 text-xl font-bold font-mono" :class="Number(summary.unreceived_amount || 0) > 0 ? 'text-warning' : ''">
              {{ formatMoney(summary.unreceived_amount) }}
            </div>
          </button>
          <button
            type="button"
            class="relative rounded-md border p-3 text-left transition-colors pr-10"
            :class="metricCardClass('invoice_balance')"
            :aria-pressed="hasMetricFilter('invoice_balance')"
            @click="toggleMetricFilter('invoice_balance')"
          >
            <UIcon
              v-if="hasMetricFilter('invoice_balance')"
              name="i-lucide-filter"
              class="absolute right-3 top-3 size-4 text-primary"
            />
            <div class="text-xs text-muted">
              发票余额
            </div>
            <div class="mt-1 text-xl font-bold font-mono">
              {{ formatMoney(summary.invoice_balance) }}
            </div>
          </button>
          <button
            type="button"
            class="relative rounded-md border p-3 text-left transition-colors pr-10"
            :class="metricCardClass('receivable_uncollected')"
            :aria-pressed="hasMetricFilter('receivable_uncollected')"
            @click="toggleMetricFilter('receivable_uncollected')"
          >
            <UIcon
              v-if="hasMetricFilter('receivable_uncollected')"
              name="i-lucide-filter"
              class="absolute right-3 top-3 size-4 text-primary"
            />
            <div class="text-xs text-muted">
              应收未收
            </div>
            <div class="mt-1 text-xl font-bold font-mono" :class="Number(summary.receivable_uncollected_amount || 0) > 0 ? 'text-primary' : ''">
              {{ formatMoney(summary.receivable_uncollected_amount) }}
            </div>
          </button>
        </div>

        <div class="altoc-list-table p-2">
          <UTable
            v-model:sorting="sorting"
            :data="items"
            :columns="columns"
            :loading="status === 'pending'"
            :sorting-options="tableSortingOptions"
            sticky="header"
            class="altoc-sticky-table w-full"
            :ui="{ base: 'w-full min-w-[1360px]', thead: 'z-20 bg-default' }"
          >
            <template #code-cell="{ row }">
              <NuxtLink :to="`/contracts/${row.original.id}`" class="font-mono text-xs text-primary hover:underline">
                {{ row.original.code }}
              </NuxtLink>
            </template>
            <template #name-cell="{ row }">
              <NuxtLink :to="`/contracts/${row.original.id}`" class="font-medium text-primary hover:underline">
                <TruncatedText :text="row.original.name" :max="16" />
              </NuxtLink>
            </template>
            <template #customer_name-cell="{ row }">
              <TruncatedText :text="row.original.customer_name" :max="16" />
            </template>
            <template #amount_tax_inclusive-cell="{ row }">
              <div class="text-right font-mono">
                {{ formatMoney(row.original.amount_tax_inclusive) }}
              </div>
            </template>
            <template #receivable_uncollected_amount-cell="{ row }">
              <div class="text-right font-mono">
                {{ formatMoney(row.original.receivable_uncollected_amount) }}
              </div>
            </template>
            <template #unreceived_amount-cell="{ row }">
              <div class="text-right font-mono">
                {{ formatMoney(row.original.unreceived_amount) }}
              </div>
            </template>
            <template #invoice_balance-cell="{ row }">
              <div class="text-right font-mono">
                {{ formatMoney(row.original.invoice_balance) }}
              </div>
            </template>
            <template #status-cell="{ row }">
              <UBadge :color="contractStatusMeta(row.original.status).color as any" variant="subtle" size="sm">
                {{ contractStatusMeta(row.original.status).label }}
              </UBadge>
            </template>
            <template #sign_date-cell="{ row }">
              <span class="text-xs">{{ row.original.sign_date || '-' }}</span>
            </template>
            <template #end_date-cell="{ row }">
              <span class="text-xs">{{ row.original.end_date || '-' }}</span>
            </template>
            <template #owner_user_id-cell="{ row }">
              <UserName :uid="row.original.owner_user_id" />
            </template>
            <template #actions-cell="{ row }">
              <div class="flex items-center justify-end gap-1">
                <UButton
                  icon="i-lucide-eye"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  title="查看合同"
                  @click="router.push(`/contracts/${row.original.id}`)"
                />
                <UButton
                  v-if="hasContractScan(row.original)"
                  icon="i-lucide-file-type"
                  variant="ghost"
                  color="error"
                  size="xs"
                  title="预览合同扫描件"
                  @click="openContractScan(row.original)"
                />
              </div>
            </template>
            <template #empty>
              <div class="flex flex-col items-center py-12 text-muted">
                <UIcon name="i-lucide-file-signature" class="text-4xl mb-3" />
                <p class="text-sm mb-3">
                  暂无合同数据
                </p>
                <UButton
                  label="创建第一个合同"
                  color="primary"
                  variant="soft"
                  @click="router.push('/contracts/new')"
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

  <UModal v-model:open="scanPreviewOpen" :title="scanPreviewTitle" :ui="{ content: 'sm:max-w-6xl' }">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <span class="font-semibold truncate">{{ scanPreviewTitle }}</span>
            <div class="flex items-center gap-1 shrink-0">
              <UButton
                icon="i-lucide-external-link"
                variant="ghost"
                color="neutral"
                size="xs"
                title="新窗口打开"
                @click="openContractScanExternal"
              />
              <UButton
                icon="i-lucide-x"
                variant="ghost"
                color="neutral"
                size="xs"
                title="关闭"
                @click="scanPreviewOpen = false"
              />
            </div>
          </div>
        </template>
        <iframe
          v-if="scanPreviewUrl"
          :src="scanPreviewUrl"
          class="h-[75vh] w-full rounded border border-default bg-white"
          :title="scanPreviewTitle"
        />
      </UCard>
    </template>
  </UModal>
</template>
