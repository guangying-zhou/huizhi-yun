<script setup lang="ts">
import type { ApiResponse, DigitalAssetItem, ListPayload, SummaryMetric } from '../../types'
import { useAssetsModule } from '../../../layer/useAssetsModule'
import { useAssetLabels } from '../../composables/useAssetLabels'

definePageMeta({ hostContentInset: false })

usePageTitle('数字资产')

const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()

const route = useRoute()
const createOpen = ref(false)
function openCreate() {
  if (hosted) void navigateTo({ path: moduleUrl('/digital-assets/new'), query: { returnTo: route.fullPath } })
  else createOpen.value = true
}
const { hosted, moduleUrl, cacheKey } = useAssetsModule()
const listState = useState(cacheKey('digital-assets-list-state'), () => ({ page: 1, search: '', status: 'all' }))
const page = ref(listState.value.page)
const pageSize = ref(20)
const { search, debounced: debouncedSearch } = useDebouncedSearch({
  initial: listState.value.search,
  onChange: () => {
    page.value = 1
  }
})
const selectedStatus = ref<'all' | 'active' | 'archived' | 'deprecated'>(listState.value.status as 'all' | 'active' | 'archived' | 'deprecated')
onBeforeUnmount(() => {
  listState.value = { page: page.value, search: search.value, status: selectedStatus.value }
})
const { loadPermissions, hasPermission, loaded: permissionsLoaded } = usePermissions()
const { data: writeAccess } = await useFetch<ApiResponse<{ digital_assets: boolean, ip_assets: boolean }>>(moduleUrl('/api/v1/write-access'), {
  key: cacheKey('assets-write-access'),
  immediate: hosted
})
if (!hosted) await loadPermissions()
const canEditDigitalAsset = computed(() => hosted
  ? writeAccess.value?.data?.digital_assets === true
  : permissionsLoaded.value && hasPermission('digital_assets', 'edit'))

watch(selectedStatus, () => {
  page.value = 1
})

const query = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  search: debouncedSearch.value.trim() || undefined,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))

const { data: response, refresh, status } = await useFetch<ApiResponse<ListPayload<DigitalAssetItem>>>(moduleUrl('/api/v1/digital-assets'), {
  key: cacheKey('digital-assets'),
  query
})
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
  navigateTo(moduleUrl(`/digital-assets/${row.original.id}`))
}

const handleCreated = async (id: number) => {
  await refresh()
  navigateTo(moduleUrl(`/digital-assets/${id}`))
}
</script>

<template>
  <UDashboardPanel id="digital-assets" grow>
    <template #body>
      <div class="space-y-4 p-4 sm:p-6">
        <ContentPageHeader
          :hosted="hosted"
          title="数字资产"
          description="查看企业数字资产及其访问范围。"
          breadcrumb="产品 / 产品资产"
        >
          <template #actions>
            <UButton
              v-if="!hosted || canEditDigitalAsset"
              icon="i-lucide-plus"
              color="primary"
              class="shrink-0"
              @click="openCreate"
            >
              新增资产
            </UButton>
          </template>
        </ContentPageHeader>
        <AssetsSummaryMetricGrid :metrics="metrics" />

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">台账列表</span>
              <UButton
                v-if="!hosted"
                icon="i-lucide-plus"
                color="primary"
                class="shrink-0"
                @click="openCreate"
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

  <AssetsDigitalAssetCreateModal
    v-if="!hosted"
    :open="createOpen"
    @update:open="createOpen = $event"
    @created="handleCreated"
  />
</template>
