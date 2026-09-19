<script setup lang="ts">
import type { ApiResponse, IpAssetItem, ListPayload, SummaryMetric } from '~/types'
import { useAssetsModule } from '../../../layer/useAssetsModule'

usePageTitle('知识产权资产')

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
const selectedStatus = ref<'all' | 'active' | 'applying' | 'expired'>('all')
const { hosted, moduleUrl, cacheKey } = useAssetsModule()
const { loadPermissions, hasPermission, loaded: permissionsLoaded } = usePermissions()
await loadPermissions()
const canEditIpAsset = computed(() => permissionsLoaded.value && hasPermission('ip_assets', 'edit'))

watch(selectedStatus, () => {
  page.value = 1
})

const query = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  search: debouncedSearch.value.trim() || undefined,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))

const { data: response, refresh, status } = await useFetch<ApiResponse<ListPayload<IpAssetItem>>>(moduleUrl('/api/v1/ip-assets'), {
  key: cacheKey('ip-assets'),
  query
})
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)

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
  navigateTo(moduleUrl(`/ip-assets/${row.original.id}`))
}

const handleCreated = async (id: number) => {
  await refresh()
  navigateTo(moduleUrl(`/ip-assets/${id}`))
}
</script>

<template>
  <UDashboardPanel id="ip-assets" grow>
    <template #body>
      <div class="p-4 space-y-4">
        <AssetsSummaryMetricGrid :metrics="metrics" />

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">台账列表</span>
              <UButton
                v-if="!hosted || canEditIpAsset"
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
            :ui="selectableTableUi"
            @select="handleRowSelect"
          >
            <template #empty>
              <CommonEmptyState
                icon="i-lucide-shield"
                title="暂无知识产权"
                description="调整筛选条件，或新建一条知识产权。"
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
        <UAlert
          v-if="hosted && !canEditIpAsset"
          color="info"
          variant="soft"
          icon="i-lucide-info"
          title="当前仅提供知识产权资产只读台账"
          description="创建、编辑及产品或文档关联将在写入范围合同完成后开放。"
        />
      </div>
    </template>
  </UDashboardPanel>

  <AssetsIpAssetCreateModal v-if="!hosted || canEditIpAsset" :open="createOpen" @update:open="createOpen = $event" @created="handleCreated" />
</template>
