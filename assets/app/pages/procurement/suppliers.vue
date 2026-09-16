<script setup lang="ts">
import type { ApiResponse, ListPayload, SupplierItem, SummaryMetric } from '~/types'

usePageTitle('供应商台账')

const createOpen = ref(false)
const editOpen = ref(false)
const selectedSupplier = ref<SupplierItem | null>(null)
const page = ref(1)
const pageSize = ref(20)
const { search, debounced: debouncedSearch } = useDebouncedSearch({
  onChange: () => {
    page.value = 1
  }
})
const selectedStatus = ref<'all' | 'active' | 'disabled'>('all')
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()

watch(selectedStatus, () => {
  page.value = 1
})

const query = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  search: debouncedSearch.value.trim() || undefined,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))

const { data: response, refresh, status } = await useFetch<ApiResponse<ListPayload<SupplierItem>>>('/api/v1/suppliers', {
  query
})
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)

const metrics = computed<SummaryMetric[]>(() => response.value?.data.summary || [])
const items = computed<SupplierItem[]>(() => response.value?.data.items || [])
const displayItems = computed(() => items.value.map(item => ({
  ...item,
  supplier_type_label: getLabel('supplier_type', item.supplier_type),
  status_label: getLabel('supplier_status', item.status)
})))
const total = computed(() => response.value?.data.total || 0)
const loading = computed(() => status.value === 'pending')

const columns = [
  { accessorKey: 'supplier_code', header: '编号' },
  { accessorKey: 'supplier_name', header: '供应商' },
  { accessorKey: 'supplier_type_label', header: '类型' },
  { accessorKey: 'status_label', header: '状态' },
  { accessorKey: 'contact_name', header: '联系人' }
]

const handleCreated = async () => {
  await refresh()
}
const handleRowSelect = (_event: Event, row: { original: SupplierItem }) => {
  selectedSupplier.value = row.original
  editOpen.value = true
}
const handleUpdated = async () => {
  await refresh()
}
</script>

<template>
  <UDashboardPanel id="suppliers" grow>
    <template #body>
      <div class="p-4 space-y-4">
        <AssetsSummaryMetricGrid :metrics="metrics" />
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">供应商列表</span>
              <UButton
                icon="i-lucide-plus"
                color="primary"
                variant="soft"
                class="shrink-0"
                @click="createOpen = true"
              >
                新增供应商
              </UButton>
            </div>
          </template>

          <div class="mb-4 space-y-3">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
              <UInput
                v-model="search"
                icon="i-lucide-search"
                class="lg:max-w-sm"
                placeholder="搜索供应商名称、编号、类型或联系人"
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
                  启用中
                </UButton>
                <UButton
                  :variant="selectedStatus === 'disabled' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'disabled'"
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
                icon="i-lucide-truck"
                title="暂无供应商"
                description="调整筛选条件，或新建一个供应商。"
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

  <AssetsSupplierCreateModal
    :open="createOpen"
    @update:open="createOpen = $event"
    @created="handleCreated"
  />

  <AssetsSupplierEditModal
    :open="editOpen"
    :supplier="selectedSupplier"
    @update:open="editOpen = $event"
    @updated="handleUpdated"
  />
</template>
