<script setup lang="ts">
import { useAssetLabels } from '../../composables/useAssetLabels'
import { useAssetDictionaries } from '../../composables/useAssetDictionaries'
import AssetsSummaryMetricGrid from './SummaryMetricGrid.vue'
import AssetsProductAssetCreateModal from './ProductAssetCreateModal.vue'
import AssetsTechnologyBaseCreateModal from './TechnologyBaseCreateModal.vue'
import { useAssetsModule } from '../../../layer/useAssetsModule'
import type { ApiResponse, ListPayload, ProductAssetItem, SummaryMetric, TechnologyBaseItem } from '../../types'
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import type { Column } from '@tanstack/vue-table'
import { h, resolveComponent } from 'vue'
import {
  normalizeCustomerDomains,
  preferDictionaryOptions,
  productLifecycleStatusOptions,
  productLineFallbackOptions
} from '../../utils/productAssets'

const { moduleUrl, cacheKey, hosted } = useAssetsModule()

usePageTitle('产品资产')

type AssetListTab = 'product' | 'technology_base'
type ProductAssetDisplayItem = {
  id: number
  item_type: 'product' | 'technology_base'
  code: string
  name: string
  domain: string
  category_value: string
  status_value: string
  asset_value: string
  investment_strategy: string
  status_label: string
  raw: ProductAssetItem | TechnologyBaseItem
}

const UButton = resolveComponent('UButton')

const { loadDictionaries, getOptions } = useAssetDictionaries()
const { getLabel } = useAssetLabels()
await loadDictionaries()

const createProductOpen = ref(false)
const createBaseOpen = ref(false)
const productPage = ref(1)
const productPageSize = 20
const { search, debounced: debouncedSearch, flush } = useDebouncedSearch({ onChange: () => {
  productPage.value = 1
} })
const activeTab = ref<AssetListTab>('product')
const selectedProductCategory = ref('all')
const selectedProductStatus = ref('all')
const selectedBaseCategory = ref('all')
const selectedBaseStatus = ref('all')
const productSorting = ref([{ id: 'code', desc: false }])
const baseSorting = ref([{ id: 'code', desc: false }])

watch([selectedProductCategory, selectedProductStatus, productSorting], () => {
  productPage.value = 1
}, { deep: true, flush: 'sync' })

const productQuery = computed(() => ({
  search: debouncedSearch.value.trim() || undefined,
  page: productPage.value,
  pageSize: productPageSize,
  product_line: selectedProductCategory.value === 'all' ? undefined : selectedProductCategory.value,
  status: selectedProductStatus.value === 'all' ? undefined : selectedProductStatus.value,
  sortBy: productSorting.value[0]?.id,
  sortOrder: productSorting.value[0]?.desc ? 'desc' : 'asc'
}))

const [{ data: productResponse, refresh: refreshProducts, status: productStatus, error: productError }, { data: baseResponse, refresh: refreshBases, status: baseStatus, error: baseError }] = await Promise.all([
  useFetch<ApiResponse<ListPayload<ProductAssetItem>>>(moduleUrl('/api/v1/products'), { key: cacheKey('products'), query: productQuery }),
  // The Host has a purpose-specific, scope-checked candidate projection.  It
  // is intentionally distinct from the standalone technology-base catalogue:
  // only fields needed to read/link a product base cross this boundary.
  useFetch<ApiResponse<ListPayload<TechnologyBaseItem>>>(moduleUrl(hosted ? '/api/v1/products/link-candidates/bases' : '/api/v1/technology-bases'), {
    key: cacheKey('technology-bases'),
    ...(hosted ? {} : { query: computed(() => ({ search: debouncedSearch.value.trim() || undefined })) })
  })
])

const loading = computed(() => activeTab.value === 'product' ? productStatus.value === 'pending' : baseStatus.value === 'pending')
const listError = computed(() => activeTab.value === 'product' ? productError.value : baseError.value)
const retryList = () => activeTab.value === 'product' ? refreshProducts() : refreshBases()
const activeSorting = computed({
  get: () => activeTab.value === 'product' ? productSorting.value : baseSorting.value,
  set: (value: { id: string, desc: boolean }[]) => {
    if (activeTab.value === 'product') {
      productSorting.value = value
      return
    }
    baseSorting.value = value
  }
})
const productItems = computed<ProductAssetItem[]>(() => productResponse.value?.data.items || [])
const baseItems = computed<TechnologyBaseItem[]>(() => baseResponse.value?.data.items || [])
const productLineOptions = computed(() => preferDictionaryOptions(getOptions('product_line'), productLineFallbackOptions))
const productStatusOptions = computed(() => preferDictionaryOptions(getOptions('product_status'), productLifecycleStatusOptions))
const baseTypeOptions = computed(() => getOptions('technology_base_type'))
const baseStatusOptions = computed(() => getOptions('technology_base_status'))

const activeCategory = computed({
  get: () => activeTab.value === 'product' ? selectedProductCategory.value : selectedBaseCategory.value,
  set: (value: string) => {
    if (activeTab.value === 'product') {
      selectedProductCategory.value = value
      return
    }
    selectedBaseCategory.value = value
  }
})

const activeStatus = computed({
  get: () => activeTab.value === 'product' ? selectedProductStatus.value : selectedBaseStatus.value,
  set: (value: string) => {
    if (activeTab.value === 'product') {
      selectedProductStatus.value = value
      return
    }
    selectedBaseStatus.value = value
  }
})

function customerDomainLabel(value: ProductAssetItem['customer_domain']) {
  const values = normalizeCustomerDomains(value)
  return values.length > 0 ? values.map(item => getLabel('customer_domain', item)).join('、') : '-'
}

const categoryOptions = computed(() => {
  if (activeTab.value === 'product') {
    return [
      { label: '全部产品线', value: 'all' },
      ...productLineOptions.value.map(option => ({ label: option.label, value: option.value }))
    ]
  }

  return [
    { label: '全部底座类型', value: 'all' },
    ...baseTypeOptions.value.map(option => ({ label: option.label, value: option.value }))
  ]
})

const statusOptions = computed(() => {
  if (activeTab.value === 'product') {
    return [
      { label: '全部生命周期状态', value: 'all' },
      ...productStatusOptions.value.map(option => ({ label: option.label, value: option.value }))
    ]
  }

  return [
    { label: '全部底座状态', value: 'all' },
    ...baseStatusOptions.value.map(option => ({ label: option.label, value: option.value }))
  ]
})

const searchPlaceholder = computed(() => activeTab.value === 'product'
  ? '搜索编码、名称、产品线、业务域或项目'
  : '搜索编码、名称、底座类型、服务对象或项目')

const metrics = computed<SummaryMetric[]>(() => {
  const productCount = productResponse.value?.data.total || 0
  const baseCount = baseItems.value.length
  const productCategoryCount = productLineOptions.value.length

  return [
    { label: '产品资产', value: productCount + baseCount, hint: '产品主档 + 技术底座', color: 'primary' },
    { label: '产品分类', value: productCategoryCount, hint: '已定义分类', color: 'warning' },
    { label: '产品主档', value: productCount, hint: '平台产品家底', color: 'success' },
    { label: '技术底座', value: baseCount, hint: '基础平台与共用模块', color: 'info' }
  ]
})

const tabItems = computed(() => [
  {
    label: '产品主档',
    value: 'product' satisfies AssetListTab,
    icon: 'i-lucide-package-2'
  },
  {
    label: '技术底座',
    value: 'technology_base' satisfies AssetListTab,
    icon: 'i-lucide-blocks'
  }
])

const productRows = computed<ProductAssetDisplayItem[]>(() => productItems.value
  .map(item => ({
    id: item.id,
    item_type: 'product' as const,
    code: item.product_code,
    name: item.product_name,
    domain: `${getLabel('product_line', item.product_line)} / ${customerDomainLabel(item.customer_domain)}`,
    category_value: item.product_line,
    status_value: item.status,
    asset_value: getLabel('product_asset_value_type', item.asset_level),
    investment_strategy: getLabel('product_level', item.product_level),
    status_label: getLabel('product_status', item.status),
    raw: item
  })))

const baseRows = computed<ProductAssetDisplayItem[]>(() => baseItems.value
  .map(item => ({
    id: item.id,
    item_type: 'technology_base' as const,
    code: item.base_code,
    name: item.base_name,
    domain: getLabel('technology_base_type', item.base_type),
    category_value: item.base_type,
    status_value: item.status,
    asset_value: getLabel('asset_level', item.asset_level),
    investment_strategy: '-',
    status_label: getLabel('technology_base_status', item.status),
    raw: item
  }))
  .filter(item => selectedBaseCategory.value === 'all' || item.category_value === selectedBaseCategory.value)
  .filter(item => selectedBaseStatus.value === 'all' || item.status_value === selectedBaseStatus.value)
  .filter(item => !hosted || !debouncedSearch.value.trim() || [item.code, item.name, item.domain].some(value => value.toLowerCase().includes(debouncedSearch.value.trim().toLowerCase()))))

const displayItems = computed(() => activeTab.value === 'product' ? productRows.value : baseRows.value)

const total = computed(() => activeTab.value === 'product' ? productResponse.value?.data.total || 0 : displayItems.value.length)
const currentListTitle = computed(() => activeTab.value === 'product' ? '产品主档列表' : '技术底座列表')

function sortableHeader(column: Column<ProductAssetDisplayItem>, label: string) {
  const isSorted = column.getIsSorted()
  return h(UButton, {
    'color': 'neutral',
    'variant': 'ghost',
    label,
    'icon': isSorted
      ? isSorted === 'asc'
        ? 'i-lucide-arrow-up-narrow-wide'
        : 'i-lucide-arrow-down-wide-narrow'
      : 'i-lucide-arrow-up-down',
    'class': '-mx-2.5',
    'aria-label': `按${label}${isSorted === 'asc' ? '倒序' : '正序'}排序`,
    'onClick': () => column.toggleSorting(column.getIsSorted() === 'asc')
  })
}

const columns = computed<TableColumn<ProductAssetDisplayItem>[]>(() => {
  const baseColumns: TableColumn<ProductAssetDisplayItem>[] = [
    { accessorKey: 'code', header: ({ column }) => sortableHeader(column, '编码') },
    { accessorKey: 'name', header: ({ column }) => sortableHeader(column, '名称') },
    { accessorKey: 'domain', header: ({ column }) => sortableHeader(column, '分类/域') },
    { accessorKey: 'asset_value', header: ({ column }) => sortableHeader(column, '资产价值') }
  ]

  if (activeTab.value === 'product') {
    baseColumns.push({
      accessorKey: 'investment_strategy',
      header: ({ column }) => sortableHeader(column, '投资策略')
    })
  }

  baseColumns.push({ accessorKey: 'status_label', header: ({ column }) => sortableHeader(column, '状态') })
  return baseColumns
})

const createItems = computed<DropdownMenuItem[]>(() => ([
  ...(hosted ? [{ label: '产品线管理', icon: 'i-lucide-settings-2', onSelect: () => navigateTo(moduleUrl('/admin/asset-categories')) }] : []),
  {
    label: '新增产品主档',
    icon: 'i-lucide-package-2',
    onSelect: () => {
      createProductOpen.value = true
    }
  },
  {
    label: hosted ? '新增技术底座（待迁移）' : '新增技术底座',
    disabled: hosted,
    icon: 'i-lucide-blocks',
    onSelect: () => {
      createBaseOpen.value = true
    }
  }
]))

const handleRowSelect = (_event: Event, row: { original: { item_type: 'product' | 'technology_base', id: number } }) => {
  if (row.original.item_type === 'product') {
    navigateTo(moduleUrl(`/products/${row.original.id}`))
    return
  }

  // The composed Host currently exposes the scoped list/link projection only;
  // the standalone detail BFF is deliberately not registered yet.
  if (!hosted) navigateTo(moduleUrl(`/technology-bases/${row.original.id}`))
}

const handleRefresh = async () => {
  await Promise.all([refreshProducts(), refreshBases()])
}
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(handleRefresh))
onBeforeUnmount(clearRefresh)

const handleProductCreated = async (id: number) => {
  await handleRefresh()
  navigateTo(moduleUrl(`/products/${id}`))
}

const handleBaseCreated = async (id: number) => {
  await handleRefresh()
  navigateTo(moduleUrl(`/technology-bases/${id}`))
}
</script>

<template>
  <UDashboardPanel id="product-assets" grow>
    <template #body>
      <div class="p-4 space-y-4">
        <AssetsSummaryMetricGrid v-if="!productError && !baseError" :metrics="metrics" />

        <UTabs
          v-model="activeTab"
          :items="tabItems"
          variant="link"
          color="primary"
          :content="false"
          :ui="{
            list: 'px-4 py-1 border-b border-default rounded-none bg-transparent gap-1',
            trigger: 'grow-0 shrink-0'
          }"
        >
          <template #list-trailing>
            <div class="ml-auto shrink-0">
              <UDropdownMenu :items="createItems" :content="{ align: 'end' }">
                <UButton icon="i-lucide-plus" color="primary">
                  新增资产
                </UButton>
              </UDropdownMenu>
            </div>
          </template>
        </UTabs>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">{{ currentListTitle }}</span>
              <UBadge v-if="!listError" color="neutral" variant="soft">
                {{ total }} 条
              </UBadge>
            </div>
          </template>

          <div class="mb-4 space-y-3">
            <div class="grid gap-3 lg:grid-cols-[minmax(0,14rem)_minmax(0,14rem)_minmax(0,1fr)]">
              <USelect
                id="product-asset-category-filter"
                v-model="activeCategory"
                name="product-asset-category-filter"
                :items="categoryOptions"
                class="w-full"
                aria-label="按分类过滤"
              />
              <USelect
                id="product-asset-status-filter"
                v-model="activeStatus"
                name="product-asset-status-filter"
                :items="statusOptions"
                class="w-full"
                aria-label="按状态过滤"
              />
              <UInput
                id="product-asset-search"
                v-model="search"
                name="product-asset-search"
                icon="i-lucide-search"
                class="w-full"
                :placeholder="searchPlaceholder"
                @keyup.enter="flush"
              />
            </div>
          </div>

          <UAlert
            v-if="listError"
            color="error"
            icon="i-lucide-circle-alert"
            title="列表加载失败"
            description="暂时无法读取列表，请重试。搜索和筛选条件已保留。"
            :actions="[{ label: '重试', color: 'neutral', variant: 'outline', loading, onClick: retryList }]"
          />
          <UTable
            v-else
            v-model:sorting="activeSorting"
            :data="displayItems"
            :sorting-options="{ manualSorting: activeTab === 'product' }"
            :columns="columns"
            :loading="loading"
            :ui="selectableTableUi"
            @select="handleRowSelect"
          >
            <template #empty>
              <CommonEmptyState icon="i-lucide-package-search" title="暂无匹配记录" description="调整搜索或筛选条件后重试。" />
            </template>
          </UTable>
          <div v-if="activeTab === 'product' && !listError" class="flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4">
            <span class="text-sm text-muted">共 {{ total }} 条</span>
            <UPagination
              v-model:page="productPage"
              :items-per-page="productPageSize"
              :total="total"
              :sibling-count="1"
              :disabled="loading"
            />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsProductAssetCreateModal
    :open="createProductOpen"
    @update:open="createProductOpen = $event"
    @created="handleProductCreated"
  />

  <AssetsTechnologyBaseCreateModal
    v-if="!hosted"
    :open="createBaseOpen"
    @update:open="createBaseOpen = $event"
    @created="handleBaseCreated"
  />
</template>
