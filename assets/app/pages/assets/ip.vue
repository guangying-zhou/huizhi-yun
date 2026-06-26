<script setup lang="ts">
import type { ApiResponse, IpAssetItem, ListPayload, SummaryMetric } from '~/types'

const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()

const createOpen = ref(false)
const search = ref('')
const selectedStatus = ref<'all' | 'active' | 'applying' | 'expired'>('all')

const query = computed(() => ({
  search: search.value.trim() || undefined,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))

const { data: response, refresh, status } = await useFetch<ApiResponse<ListPayload<IpAssetItem>>>('/api/v1/ip-assets', { query })

const metrics = computed<SummaryMetric[]>(() => response.value?.data.summary || [])
const items = computed<IpAssetItem[]>(() => response.value?.data.items || [])
const displayItems = computed(() => items.value.map(item => ({
  ...item,
  ip_type_label: getLabel('ip_asset_type', item.ip_type),
  status_label: getLabel('ip_asset_status', item.status)
})))
const total = computed(() => response.value?.data.total || 0)
const loading = computed(() => status.value === 'pending')

const columns = [
  { accessorKey: 'ip_code', header: '编号' },
  { accessorKey: 'ip_name', header: '名称' },
  { accessorKey: 'ip_type_label', header: '类型' },
  { accessorKey: 'registration_no', header: '登记号' },
  { accessorKey: 'status_label', header: '状态' }
]

const handleRowSelect = (_event: Event, row: { original: IpAssetItem }) => {
  navigateTo(`/ip-assets/${row.original.id}`)
}

const handleRefresh = () => refresh()
const handleCreated = async (id: number) => {
  await refresh()
  navigateTo(`/ip-assets/${id}`)
}
</script>

<template>
  <UDashboardPanel id="ip-assets" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          知识产权资产
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton icon="i-lucide-plus" color="primary" @click="createOpen = true">
          新增资产
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
              <span class="font-semibold">台账列表</span>
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
                placeholder="搜索编号、名称、类型、登记号、权利人或负责人"
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
                  有效
                </UButton>
                <UButton
                  :variant="selectedStatus === 'applying' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'applying'"
                >
                  申请中
                </UButton>
                <UButton
                  :variant="selectedStatus === 'expired' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'expired'"
                >
                  已过期
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

  <AssetsIpAssetCreateModal :open="createOpen" @update:open="createOpen = $event" @created="handleCreated" />
</template>
