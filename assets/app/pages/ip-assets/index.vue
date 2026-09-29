<script setup lang="ts">
import type { ApiResponse, IpAssetItem, ListPayload, SummaryMetric } from '../../types'
import { useAssetsModule } from '../../../layer/useAssetsModule'
import { useAssetLabels } from '../../composables/useAssetLabels'

definePageMeta({ hostContentInset: false })

usePageTitle('知识产权资产')

const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()

const route = useRoute()
const createOpen = ref(false)
function openCreate() {
  if (hosted) void navigateTo({ path: moduleUrl('/ip-assets/new'), query: { returnTo: route.fullPath } })
  else createOpen.value = true
}
const { hosted, moduleUrl, cacheKey } = useAssetsModule()
const listState = useState(cacheKey('ip-assets-list-state'), () => ({ page: 1, search: '', status: 'all' }))
const page = ref(listState.value.page)
const pageSize = ref(20)
const { search, debounced: debouncedSearch } = useDebouncedSearch({
  initial: listState.value.search,
  onChange: () => {
    page.value = 1
  }
})
const selectedStatus = ref<'all' | 'active' | 'applying' | 'expired'>(listState.value.status as 'all' | 'active' | 'applying' | 'expired')
onBeforeUnmount(() => {
  listState.value = { page: page.value, search: search.value, status: selectedStatus.value }
})
const { loadPermissions, hasPermission, loaded: permissionsLoaded } = usePermissions()
const { data: writeAccess } = await useFetch<ApiResponse<{ digital_assets: boolean, ip_assets: boolean }>>(moduleUrl('/api/v1/write-access'), {
  key: cacheKey('assets-write-access'),
  immediate: hosted
})
if (!hosted) await loadPermissions()
const canEditIpAsset = computed(() => hosted
  ? writeAccess.value?.data?.ip_assets === true
  : permissionsLoaded.value && hasPermission('ip_assets', 'edit'))

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
      <div class="space-y-4 p-4 sm:p-6">
        <ContentPageHeader
          :hosted="hosted"
          title="知识产权"
          description="查看知识产权登记、类型和有效状态。"
          breadcrumb="产品 / 产品资产"
        >
          <template #actions>
            <UButton
              v-if="!hosted || canEditIpAsset"
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
          description="当前账号没有知识产权资产编辑权限；产品和文档关联尚未迁入企业工作台。"
        />
      </div>
    </template>
  </UDashboardPanel>

  <AssetsIpAssetCreateModal
    v-if="!hosted"
    :open="createOpen"
    @update:open="createOpen = $event"
    @created="handleCreated"
  />
</template>
