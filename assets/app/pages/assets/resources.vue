<script setup lang="ts">
import type { ApiResponse, AssetListItem, ListPayload, SummaryMetric } from '~/types'

const createOpen = ref(false)
const search = ref('')
const selectedStatus = ref<'all' | 'active' | 'inactive'>('all')
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()

const query = computed(() => ({
  category: 'resource',
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
  navigateTo(`/assets/${row.original.public_id || row.original.id}`)
}

const handleRefresh = () => refresh()
const handleCreated = async (asset: { id: number, public_id?: string | null }) => {
  await refresh()
  await navigateTo(`/assets/${asset.public_id || asset.id}`)
}
</script>

<template>
  <UDashboardPanel id="resource-assets" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          资源资产
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          @click="createOpen = true"
        >
          新增资源
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
              <span class="font-semibold">资源列表</span>
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
            @select="handleRowSelect"
          />
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
