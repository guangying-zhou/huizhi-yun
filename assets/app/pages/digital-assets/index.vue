<script setup lang="ts">
import type { ApiResponse, DigitalAssetItem, ListPayload, SummaryMetric } from '~/types'

usePageTitle('数字资产')

const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()

const createOpen = ref(false)
const page = ref(1)
const pageSize = ref(20)
const { search, debounced: debouncedSearch } = useDebouncedSearch({
  onChange: () => {
    page.value = 1
  }
})
const selectedStatus = ref<'all' | 'active' | 'archived' | 'deprecated'>('all')

watch(selectedStatus, () => {
  page.value = 1
})

const query = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  search: debouncedSearch.value.trim() || undefined,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))

const { data: response, refresh, status } = await useFetch<ApiResponse<ListPayload<DigitalAssetItem>>>('/api/v1/digital-assets', { query })
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)

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

const handleCreated = async (id: number) => {
  await refresh()
  navigateTo(`/digital-assets/${id}`)
}
</script>

<template>
  <UDashboardPanel id="digital-assets" grow>
    <template #body>
      <div class="p-4 space-y-4">
        <AssetsSummaryMetricGrid :metrics="metrics" />

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">台账列表</span>
              <UButton
                icon="i-lucide-plus"
                color="primary"
                class="shrink-0"
                @click="createOpen = true"
              >
                新增资产
              </UButton>
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
            :ui="selectableTableUi"
            @select="handleRowSelect"
          >
            <template #empty>
              <CommonEmptyState
                icon="i-lucide-database"
                title="暂无数字资产"
                description="调整筛选条件，或新建一条数字资产。"
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

  <AssetsDigitalAssetCreateModal :open="createOpen" @update:open="createOpen = $event" @created="handleCreated" />
</template>
