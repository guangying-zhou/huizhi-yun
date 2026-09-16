<script setup lang="ts">
import type { ApiResponse, AssetListItem, ListPayload, SummaryMetric } from '~/types'

usePageTitle('实物资产')

const createOpen = ref(false)
const page = ref(1)
const pageSize = ref(20)
const { search, debounced: debouncedSearch } = useDebouncedSearch({
  onChange: () => {
    page.value = 1
  }
})
const selectedStatus = ref<'all' | 'in_stock' | 'in_use'>('all')
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()

watch(selectedStatus, () => {
  page.value = 1
})

const query = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  category: 'physical',
  search: debouncedSearch.value.trim() || undefined,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))

const { data: response, refresh, status } = await useFetch<ApiResponse<ListPayload<AssetListItem>>>('/api/v1/assets', {
  query
})
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)

const metrics = computed<SummaryMetric[]>(() => response.value?.data.summary || [])
const items = computed<AssetListItem[]>(() => response.value?.data.items || [])
const displayItems = computed(() => items.value.map(item => ({
  ...item,
  subtype_label: item.physical_item_type ? `${item.asset_subtype} / ${item.physical_item_type}` : item.asset_subtype,
  status_label: getLabel('asset_status_physical', item.status),
  purpose_label: getLabel('asset_purpose', item.asset_purpose)
})))
const total = computed(() => response.value?.data.total || 0)
const loading = computed(() => status.value === 'pending')

const columns = [
  { accessorKey: 'asset_code', header: '资产编号' },
  { accessorKey: 'asset_name', header: '资产名称' },
  { accessorKey: 'subtype_label', header: '分类' },
  { accessorKey: 'status_label', header: '状态' },
  { accessorKey: 'user_uid', header: '使用人' }
]

const handleRowSelect = (_event: Event, row: { original: AssetListItem }) => {
  navigateTo(`/items/${row.original.public_id || row.original.id}`)
}

const handleCreated = async (asset: { id: number, public_id?: string | null }) => {
  await refresh()
  await navigateTo(`/items/${asset.public_id || asset.id}`)
}
</script>

<template>
  <UDashboardPanel id="physical-assets" grow>
    <template #body>
      <div class="p-4 space-y-4">
        <AssetsSummaryMetricGrid :metrics="metrics" />

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">资产列表</span>
              <UButton
                icon="i-lucide-plus"
                color="primary"
                variant="soft"
                class="shrink-0"
                @click="createOpen = true"
              >
                补录资产
              </UButton>
            </div>
          </template>

          <div class="mb-4 space-y-3">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
              <UInput
                v-model="search"
                icon="i-lucide-search"
                class="lg:max-w-sm"
                placeholder="搜索资产编号、名称、项目或人员"
              />
              <div class="flex flex-wrap gap-2">
                <UButton :variant="selectedStatus === 'all' ? 'solid' : 'outline'" size="sm" @click="selectedStatus = 'all'">
                  全部
                </UButton>
                <UButton
                  :variant="selectedStatus === 'in_stock' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'in_stock'"
                >
                  库存中
                </UButton>
                <UButton
                  :variant="selectedStatus === 'in_use' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'in_use'"
                >
                  使用中
                </UButton>
              </div>
            </div>
          </div>

          <UTable
            :data="displayItems"
            :columns="columns"
            :loading="loading"
            :ui="selectableTableUi"
            @select="handleRowSelect"
          >
            <template #empty>
              <CommonEmptyState
                icon="i-lucide-laptop"
                title="暂无实物资产"
                description="调整筛选条件，或新建一条实物资产。"
              />
            </template>
          </UTable>

          <div
            v-if="total > 0"
            class="mt-4 flex items-center justify-between border-t border-default pt-4"
          >
            <span class="text-sm text-muted">共 {{ total }} 条</span>
            <UPagination
              v-model:page="page"
              :items-per-page="pageSize"
              :total="total"
            />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsAssetCreateSlideover
    :open="createOpen"
    category="physical"
    @update:open="createOpen = $event"
    @created="handleCreated"
  />
</template>
