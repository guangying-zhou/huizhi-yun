<script setup lang="ts">
import type { ApiResponse, ListPayload, ProductAssetItem, SummaryMetric, TechnologyBaseItem } from '~/types'
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import type { Column } from '@tanstack/vue-table'
import { h, resolveComponent } from 'vue'
import {
  normalizeCustomerDomains,
  preferDictionaryOptions,
  preferModernOptions,
  productLifecycleStatusOptions,
  productLineFallbackOptions
} from '~/utils/productAssets'

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
const search = ref('')
const activeTab = ref<AssetListTab>('product')
const selectedProductCategory = ref('all')
const selectedProductStatus = ref('all')
const selectedBaseCategory = ref('all')
const selectedBaseStatus = ref('all')
const productSorting = ref([{ id: 'code', desc: false }])
const baseSorting = ref([{ id: 'code', desc: false }])

const productQuery = computed(() => ({
  search: search.value.trim() || undefined
}))

const baseQuery = computed(() => ({
  search: search.value.trim() || undefined
}))

const [{ data: productResponse, refresh: refreshProducts, status: productStatus }, { data: baseResponse, refresh: refreshBases, status: baseStatus }] = await Promise.all([
  useFetch<ApiResponse<ListPayload<ProductAssetItem>>>('/api/v1/products', { query: productQuery }),
  useFetch<ApiResponse<ListPayload<TechnologyBaseItem>>>('/api/v1/technology-bases', { query: baseQuery })
])

const loading = computed(() => activeTab.value === 'product' ? productStatus.value === 'pending' : baseStatus.value === 'pending')
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
const productLineOptions = computed(() => preferModernOptions(getOptions('product_line'), productLineFallbackOptions))
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
  const productCount = productItems.value.length
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
  }))
  .filter(item => selectedProductCategory.value === 'all' || item.category_value === selectedProductCategory.value)
  .filter(item => selectedProductStatus.value === 'all' || item.status_value === selectedProductStatus.value))

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
  .filter(item => selectedBaseStatus.value === 'all' || item.status_value === selectedBaseStatus.value))

const displayItems = computed(() => activeTab.value === 'product' ? productRows.value : baseRows.value)

const total = computed(() => displayItems.value.length)
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
  {
    label: '新增产品主档',
    icon: 'i-lucide-package-2',
    onSelect: () => {
      createProductOpen.value = true
    }
  },
  {
    label: '新增技术底座',
    icon: 'i-lucide-blocks',
    onSelect: () => {
      createBaseOpen.value = true
    }
  }
]))

const handleRowSelect = (_event: Event, row: { original: { item_type: 'product' | 'technology_base', id: number } }) => {
  if (row.original.item_type === 'product') {
    navigateTo(`/products/${row.original.id}`)
    return
  }

  navigateTo(`/technology-bases/${row.original.id}`)
}

const handleRefresh = async () => {
  await Promise.all([refreshProducts(), refreshBases()])
}

const handleProductCreated = async (id: number) => {
  await handleRefresh()
  navigateTo(`/products/${id}`)
}

const handleBaseCreated = async (id: number) => {
  await handleRefresh()
  navigateTo(`/technology-bases/${id}`)
}
</script>

<template>
  <UDashboardPanel id="product-assets" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          产品资产
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UDropdownMenu :items="createItems" :content="{ align: 'end' }">
          <UButton icon="i-lucide-plus" color="primary">
            新增资产
          </UButton>
        </UDropdownMenu>
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

        <UTabs
          v-model="activeTab"
          :items="tabItems"
          variant="link"
          color="primary"
          :content="false"
        />

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">{{ currentListTitle }}</span>
              <UBadge color="neutral" variant="soft">
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
              />
            </div>
          </div>

          <UTable
            v-model:sorting="activeSorting"
            :data="displayItems"
            :columns="columns"
            :loading="loading"
            @select="handleRowSelect"
          />
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
    :open="createBaseOpen"
    @update:open="createBaseOpen = $event"
    @created="handleBaseCreated"
  />
</template>
