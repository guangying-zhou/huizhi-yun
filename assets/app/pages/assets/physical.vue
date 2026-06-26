<script setup lang="ts">
import type { ApiResponse, AssetListItem, ListPayload, SummaryMetric } from '~/types'

const createOpen = ref(false)
const search = ref('')
const selectedStatus = ref<'all' | 'in_stock' | 'in_use'>('all')
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()

const query = computed(() => ({
  category: 'physical',
  search: search.value.trim() || undefined,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))

const { data: response, refresh, status } = await useFetch<ApiResponse<ListPayload<AssetListItem>>>('/api/v1/assets', {
  query
})

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
  navigateTo(`/assets/${row.original.public_id || row.original.id}`)
}

const handleRefresh = () => refresh()
const handleCreated = async (asset: { id: number, public_id?: string | null }) => {
  await refresh()
  await navigateTo(`/assets/${asset.public_id || asset.id}`)
}
</script>

<template>
  <UDashboardPanel id="physical-assets" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          实物资产
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          @click="createOpen = true"
        >
          补录资产
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
        <AssetsSummaryMetricGrid :metrics="metrics" />

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">资产列表</span>
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
            @select="handleRowSelect"
          />
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
