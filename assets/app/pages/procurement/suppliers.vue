<script setup lang="ts">
import type { ApiResponse, ListPayload, SupplierItem, SummaryMetric } from '~/types'

const createOpen = ref(false)
const editOpen = ref(false)
const selectedSupplier = ref<SupplierItem | null>(null)
const search = ref('')
const selectedStatus = ref<'all' | 'active' | 'disabled'>('all')
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()

const query = computed(() => ({
  search: search.value.trim() || undefined,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))

const { data: response, refresh, status } = await useFetch<ApiResponse<ListPayload<SupplierItem>>>('/api/v1/suppliers', {
  query
})

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

const handleRefresh = () => refresh()
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
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          供应商台账
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          @click="createOpen = true"
        >
          新增供应商
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
        <AssetsPageIntroCard title="供应商台账" description="维护采购供应商基础信息，作为采购单的统一引用源。" />
        <AssetsSummaryMetricGrid :metrics="metrics" />
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">供应商列表</span>
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
            @select="handleRowSelect"
          />
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
