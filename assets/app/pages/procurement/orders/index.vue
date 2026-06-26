<script setup lang="ts">
import type { ApiResponse, ListPayload, PurchaseOrderItem, SummaryMetric } from '~/types'

const createOpen = ref(false)
const search = ref('')
const selectedStatus = ref<'all' | 'draft' | 'pending_approval' | 'approved'>('all')
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()

const query = computed(() => ({
  search: search.value.trim() || undefined,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))

const { data: response, refresh, status } = await useFetch<ApiResponse<ListPayload<PurchaseOrderItem>>>('/api/v1/purchase-orders', {
  query
})

const metrics = computed<SummaryMetric[]>(() => response.value?.data.summary || [])
const items = computed<PurchaseOrderItem[]>(() => response.value?.data.items || [])
const displayItems = computed(() => items.value.map(item => ({
  ...item,
  purchase_type_label: getLabel('purchase_type', item.purchase_type),
  status_label: getLabel('purchase_status', item.status)
})))
const total = computed(() => response.value?.data.total || 0)
const loading = computed(() => status.value === 'pending')

const columns = [
  { accessorKey: 'order_no', header: '采购单号' },
  { accessorKey: 'purchase_type_label', header: '采购类型' },
  { accessorKey: 'status_label', header: '状态' },
  { accessorKey: 'supplier_name', header: '供应商' },
  { accessorKey: 'budget_amount', header: '预算金额' }
]

const handleRowSelect = (_event: Event, row: { original: PurchaseOrderItem }) => {
  navigateTo(`/procurement/orders/${row.original.id}`)
}

const handleRefresh = () => refresh()
const handleCreated = async (id: number) => {
  await refresh()
  await navigateTo(`/procurement/orders/${id}`)
}
</script>

<template>
  <UDashboardPanel id="purchase-orders" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          采购单
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          @click="createOpen = true"
        >
          新增采购单
        </UButton>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          @click="handleRefresh"
        >
          刷新
        </UButton>
      </Teleport>

      <div class="p-4 space-y-4">
        <AssetsPageIntroCard title="采购单管理" description="覆盖采购申请、审批、到货开通、入库激活的完整链路入口。" />
        <AssetsSummaryMetricGrid :metrics="metrics" />
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">采购单列表</span>
              <UBadge color="neutral" variant="soft">
                {{ total }} 条
              </UBadge>
            </div>
          </template>

          <div class="mb-4 space-y-3">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
              <UInput
                v-model="search"
                icon="i-lucide-search"
                class="lg:max-w-sm"
                placeholder="搜索采购单号、项目、合同、供应商或申请人"
              />
              <div class="flex flex-wrap gap-2">
                <UButton :variant="selectedStatus === 'all' ? 'solid' : 'outline'" size="sm" @click="selectedStatus = 'all'">
                  全部
                </UButton>
                <UButton
                  :variant="selectedStatus === 'draft' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'draft'"
                >
                  草稿
                </UButton>
                <UButton
                  :variant="selectedStatus === 'pending_approval' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'pending_approval'"
                >
                  待审批
                </UButton>
                <UButton
                  :variant="selectedStatus === 'approved' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'approved'"
                >
                  已批准
                </UButton>
              </div>
            </div>
          </div>

          <UTable
            :data="displayItems"
            :columns="columns"
            :loading="loading"
            @select="handleRowSelect"
          />
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsPurchaseOrderCreateModal
    :open="createOpen"
    @update:open="createOpen = $event"
    @created="handleCreated"
  />
</template>
