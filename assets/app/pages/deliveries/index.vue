<script setup lang="ts">
import type { ApiResponse, DeliveryItem, ListPayload, SummaryMetric } from '~/types'

const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()
const search = ref('')
const customerCode = ref('')
const contractCode = ref('')
const projectCode = ref('')
const selectedStatus = ref<'all' | 'preparing' | 'delivering' | 'online'>('all')

const query = computed(() => ({
  search: search.value.trim() || undefined,
  customer_code: customerCode.value.trim() || undefined,
  contract_code: contractCode.value.trim() || undefined,
  project_code: projectCode.value.trim() || undefined,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))

const { data: response, refresh, status } = await useFetch<ApiResponse<ListPayload<DeliveryItem>>>('/api/v1/deliveries', {
  query
})

const metrics = computed<SummaryMetric[]>(() => response.value?.data.summary || [])
const items = computed<DeliveryItem[]>(() => response.value?.data.items || [])
const displayItems = computed(() => items.value.map(item => ({
  ...item,
  status_label: getLabel('delivery_status', item.status)
})))
const total = computed(() => response.value?.data.total || 0)
const loading = computed(() => status.value === 'pending')

const columns = [
  { accessorKey: 'delivery_code', header: '交付编号' },
  { accessorKey: 'delivery_name', header: '交付名称' },
  { accessorKey: 'customer_code', header: '客户' },
  { accessorKey: 'project_code', header: '项目' },
  { accessorKey: 'status_label', header: '状态' }
]

const handleRowSelect = (_event: Event, row: { original: DeliveryItem }) => {
  navigateTo(`/deliveries/${row.original.id}`)
}

const handleRefresh = () => refresh()
</script>

<template>
  <UDashboardPanel id="deliveries" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          客户交付视图
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
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
        <AssetsPageIntroCard title="客户交付视图" description="串联客户、合同、项目、环境与资产，形成交付上下文。" />
        <AssetsSummaryMetricGrid :metrics="metrics" />

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">交付列表</span>
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
                placeholder="搜索交付编号、名称、客户、合同或项目"
              />
              <UInput
                v-model="customerCode"
                icon="i-lucide-building-2"
                class="lg:max-w-48"
                placeholder="客户编码"
              />
              <UInput
                v-model="contractCode"
                icon="i-lucide-file-text"
                class="lg:max-w-48"
                placeholder="合同编码"
              />
              <UInput
                v-model="projectCode"
                icon="i-lucide-briefcase-business"
                class="lg:max-w-48"
                placeholder="项目编码"
              />
              <div class="flex flex-wrap gap-2">
                <UButton :variant="selectedStatus === 'all' ? 'solid' : 'outline'" size="sm" @click="selectedStatus = 'all'">
                  全部
                </UButton>
                <UButton
                  :variant="selectedStatus === 'preparing' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'preparing'"
                >
                  准备中
                </UButton>
                <UButton
                  :variant="selectedStatus === 'delivering' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'delivering'"
                >
                  交付中
                </UButton>
                <UButton
                  :variant="selectedStatus === 'online' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'online'"
                >
                  已上线
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
</template>
