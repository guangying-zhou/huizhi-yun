<script setup lang="ts">
import type { ApiResponse, DigitalAssetItem, ListPayload, SummaryMetric } from '~/types'

const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()

const createOpen = ref(false)
const search = ref('')
const selectedStatus = ref<'all' | 'active' | 'archived' | 'deprecated'>('all')

const query = computed(() => ({
  search: search.value.trim() || undefined,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))

const { data: response, refresh, status } = await useFetch<ApiResponse<ListPayload<DigitalAssetItem>>>('/api/v1/digital-assets', { query })

const metrics = computed<SummaryMetric[]>(() => response.value?.data.summary || [])
const items = computed<DigitalAssetItem[]>(() => response.value?.data.items || [])
const displayItems = computed(() => items.value.map(item => ({
  ...item,
  digital_type_label: getLabel('digital_asset_type', item.digital_type),
  status_label: getLabel('digital_asset_status', item.status),
  access_scope_label: getLabel('digital_access_scope', item.access_scope)
})))
const total = computed(() => response.value?.data.total || 0)
const loading = computed(() => status.value === 'pending')

const columns = [
  { accessorKey: 'digital_code', header: '编号' },
  { accessorKey: 'digital_name', header: '名称' },
  { accessorKey: 'digital_type_label', header: '子类型' },
  { accessorKey: 'access_scope_label', header: '访问权限' },
  { accessorKey: 'status_label', header: '状态' }
]

const handleRowSelect = (_event: Event, row: { original: DigitalAssetItem }) => {
  navigateTo(`/digital-assets/${row.original.id}`)
}

const handleRefresh = () => refresh()
const handleCreated = async (id: number) => {
  await refresh()
  navigateTo(`/digital-assets/${id}`)
}
</script>

<template>
  <UDashboardPanel id="digital-assets" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          数字资产
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
                placeholder="搜索编号、名称、子类型、存储位置、项目或负责人"
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
                  活跃
                </UButton>
                <UButton
                  :variant="selectedStatus === 'archived' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'archived'"
                >
                  已归档
                </UButton>
                <UButton
                  :variant="selectedStatus === 'deprecated' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'deprecated'"
                >
                  已废弃
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

  <AssetsDigitalAssetCreateModal :open="createOpen" @update:open="createOpen = $event" @created="handleCreated" />
</template>
