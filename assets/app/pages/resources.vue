<script setup lang="ts">
import type { ApiResponse, AssetListItem, ListPayload, SummaryMetric } from '~/types'

usePageTitle('资源资产')

const createOpen = ref(false)
const page = ref(1)
const pageSize = ref(20)
const { search, debounced: debouncedSearch } = useDebouncedSearch({
  onChange: () => {
    page.value = 1
  }
})
const selectedStatus = ref<'all' | 'active' | 'inactive'>('all')
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()

watch(selectedStatus, () => {
  page.value = 1
})

const query = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  category: 'resource',
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
  status_label: getLabel('asset_status_resource', item.status),
  purpose_label: getLabel('asset_purpose', item.asset_purpose)
})))
const total = computed(() => response.value?.data.total || 0)
const loading = computed(() => status.value === 'pending')

const columns = [
  { accessorKey: 'asset_code', header: '资产编号' },
  { accessorKey: 'asset_name', header: '资产名称' },
  { accessorKey: 'asset_subtype', header: '分类' },
  { accessorKey: 'status_label', header: '状态' },
  { accessorKey: 'expires_at', header: '到期时间' }
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
  <UDashboardPanel id="resource-assets" grow>
    <template #body>
      <div class="p-4 space-y-4">
        <AssetsSummaryMetricGrid :metrics="metrics" />

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">资源列表</span>
              <UButton
                icon="i-lucide-plus"
                color="primary"
                variant="soft"
                class="shrink-0"
                @click="createOpen = true"
              >
                新增资源
              </UButton>
            </div>
          </template>

          <div class="mb-4 space-y-3">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
              <UInput
                v-model="search"
                icon="i-lucide-search"
                class="lg:max-w-sm"
                placeholder="搜索资产编号、名称、项目、合同或环境"
              />
              <div class="flex flex-wrap gap-2">
                <UButton :variant="selectedStatus === 'all' ? 'solid' : 'outline'" size="sm" @click="selectedStatus = 'all'">
                  全部
                </UButton>
                <UButton
                  :variant="selectedStatus === 'active' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'active'"
                >
                  使用中
                </UButton>
                <UButton
                  :variant="selectedStatus === 'inactive' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'inactive'"
                >
                  已停用
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
                icon="i-lucide-box"
                title="暂无资源资产"
                description="调整筛选条件，或新建一条资源资产。"
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
    category="resource"
    @update:open="createOpen = $event"
    @created="handleCreated"
  />
</template>
