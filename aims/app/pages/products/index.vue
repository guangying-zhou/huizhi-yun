<script setup lang="ts">
import ProductsCatalogRefresh from '../../components/products/CatalogRefresh.vue'
import ProductsOnboardForm from '../../components/products/OnboardForm.vue'
import ProductsLineOnboardForm from '../../components/products/LineOnboardForm.vue'
import { useAimsModule } from '../../../layer/useAimsModule'
const { moduleUrl, cacheKey, hosted } = useAimsModule()
import type { ProductLineGroup, ProductTreeItem, ProductTreePage } from '../../types/productTree'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '产品中心', layoutHeaderProjectSwitcher: false })
const { search, debounced, flush, reset: resetSearch } = useDebouncedSearch()
const productLine = ref('')
const productLineSelection = computed({
  get: () => productLine.value ? `line:${productLine.value}` : 'all',
  set: (value: string) => { productLine.value = value.startsWith('line:') ? value.slice(5) : '' }
})
const workspaceStatus = ref('all')
const { resetFilters: resetListFilters } = useListPage({
  filters: { keyword: search, productLine, status: workspaceStatus },
  defaults: { keyword: '', productLine: '', status: 'all' }
})
flush()

// 列表不分页：按接口上限逐页取完整数据，页数封顶避免无界请求。
const FETCH_PAGE_SIZE = 100
const MAX_FETCH_PAGES = 20
interface LoadedPage<T> { items: T[], total: number, truncated: boolean, page: ProductTreePage | null }
async function fetchAll<T>(pick: (page: ProductTreePage) => T[] | undefined, extra: Record<string, string>): Promise<LoadedPage<T>> {
  const items: T[] = []
  let total = 0
  let last: ProductTreePage | null = null
  for (let page = 1; page <= MAX_FETCH_PAGES; page++) {
    const response = await $fetch<{ code: number, data: ProductTreePage }>(moduleUrl('/api/v1/products'), {
      query: { tree: 'true', page: String(page), pageSize: String(FETCH_PAGE_SIZE), ...extra }
    })
    const batch = response?.code === 0 ? pick(response.data) : undefined
    if (!Array.isArray(batch) || !Number.isSafeInteger(response.data?.total) || response.data.total < 0) throw createError({ message: '产品列表响应不完整' })
    items.push(...batch)
    total = response.data.total
    last = response.data
    if (!batch.length || items.length >= total) break
  }
  return { items, total, truncated: items.length < total, page: last }
}
const filterQuery = computed(() => ({
  ...(debounced.value ? { keyword: debounced.value } : {}),
  ...(workspaceStatus.value === 'all' ? {} : { status: workspaceStatus.value })
}))
const { data, status, error, refresh } = await useAsyncData(
  cacheKey('product-line-tree'),
  () => fetchAll(page => page.groups, { ...filterQuery.value, ...(productLine.value ? { productLine: productLine.value } : {}) }),
  { server: false, watch: [debounced, productLine, workspaceStatus] }
)
// Filter options use the same scoped list, without the current keyword/status filters.
const { data: lineChoices, status: lineChoiceStatus, error: lineChoiceError, refresh: refreshLineChoices } = await useAsyncData(
  cacheKey('product-line-filter-options'),
  () => fetchAll(page => page.groups, {}),
  { server: false }
)
const lineOptions = computed(() => {
  const options = (lineChoices.value?.items || []).filter(line => line.line_code).map(line => ({
    value: `line:${line.line_code}`,
    label: line.label && line.label !== line.line_code ? `${line.label}（${line.line_code}）` : line.line_code
  }))
  // Keep a deep-linked selection visible even if its line is absent from this directory.
  if (productLine.value && !options.some(option => option.value === `line:${productLine.value}`)) options.unshift({ value: `line:${productLine.value}`, label: productLine.value })
  return [{ value: 'all', label: '全部产品线' }, ...options]
})
const lineChoiceAlert = useApiErrorAlert(lineChoiceError, { fallbackTitle: '产品线选项加载失败，请刷新重试' })
const { data: globalPermissions, status: permissionStatus, error: permissionError, refresh: refreshPermissions } = await useFetch(moduleUrl('/api/v1/product-permissions'), {
  key: cacheKey('product-permissions'), server: false, transform: (response: { code: number, data: { onboard: boolean } }) => response.code === 0 ? response.data : null
})
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '产品管理权限加载失败' })
const errorAlert = useApiErrorAlert(error, { fallbackTitle: '产品列表加载失败' })
const ready = computed(() => status.value === 'success' && !error.value)
const lines = computed(() => ready.value ? data.value?.items || [] : [])
const catalog = computed(() => data.value?.page || null)

const onboardForm = useTemplateRef('onboardForm')
const lineOnboardForm = useTemplateRef('lineOnboardForm')
interface LineChildren { status: 'pending' | 'success' | 'error', items: ProductTreeItem[], total: number, truncated: boolean, message: string }
const expanded = ref<Set<string>>(new Set())
const children = ref<Record<string, LineChildren>>({})
function lineKey(line: ProductLineGroup) {
  return line.line_code || '__unclassified'
}
function setChildren(key: string, state: LineChildren) {
  children.value = { ...children.value, [key]: state }
}
function resetTreeState() {
  expanded.value = new Set()
  children.value = {}
}
async function loadChildren(line: ProductLineGroup) {
  const key = lineKey(line)
  setChildren(key, { status: 'pending', items: [], total: 0, truncated: false, message: '' })
  try {
    const result = await fetchAll(page => page.items, { childLine: line.line_code, ...filterQuery.value })
    setChildren(key, { status: 'success', items: result.items, total: result.total, truncated: result.truncated, message: '' })
  } catch (cause) {
    const message = (cause as { data?: { message?: string } })?.data?.message || (cause as Error)?.message || '产品线下产品加载失败'
    setChildren(key, { status: 'error', items: [], total: 0, truncated: false, message })
  }
}
function toggleLine(line: ProductLineGroup) {
  const key = lineKey(line)
  if (expanded.value.has(key)) {
    expanded.value.delete(key)
    return
  }
  expanded.value.add(key)
  const loaded = children.value[key]
  if (!loaded || loaded.status === 'error') void loadChildren(line)
}
async function refreshTree() {
  resetTreeState()
  await Promise.all([refresh(), refreshPermissions(), refreshLineChoices()])
}
watch(filterQuery, resetTreeState)
watch(productLine, resetTreeState)
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refreshTree))
onBeforeUnmount(clearRefresh)

const statusOptions = [{ label: '全部状态', value: 'all' }, { label: '未启用', value: 'not_enabled' }, { label: '已启用', value: 'active' }, { label: '已归档', value: 'archived' }]
const statusMeta: Record<string, { label: string, color: 'success' | 'neutral' }> = {
  active: { label: '已启用', color: 'success' },
  archived: { label: '已归档', color: 'neutral' },
  not_enabled: { label: '未启用', color: 'neutral' }
}
function productTarget(item: ProductTreeItem) {
  return moduleUrl(`/products/${encodeURIComponent(item.management_product_code || item.product_code)}${item.component_id ? '/components' : ''}`)
}
function resetFilters() {
  resetSearch()
  resetListFilters()
}
</script>

<template>
  <div class="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted">
        按产品线展开查看产品。整条产品线尚未启用管理时，可统一管理，下属产品作为功能模块。
      </p>
      <ProductsCatalogRefresh v-if="!hosted && permissionStatus === 'success' && globalPermissions?.onboard === true" @activated="refreshTree()" />
    </div>
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <ProductsOnboardForm
      v-if="permissionStatus === 'success' && globalPermissions?.onboard === true"
      ref="onboardForm"
      hide-trigger
      @onboarded="refreshTree()"
    />
    <ProductsLineOnboardForm v-if="permissionStatus === 'success' && globalPermissions?.onboard === true" ref="lineOnboardForm" @onboarded="refreshTree()" />
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="flush">
      <UFormField label="搜索产品" name="keyword" class="min-w-0 flex-1 basis-56">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="产品线、产品名称或编码"
          class="w-full"
          @keyup.enter="flush"
        />
      </UFormField>
      <UFormField label="产品线" name="productLine" class="min-w-0 flex-1 basis-40">
        <USelectMenu
          v-model="productLineSelection"
          aria-label="产品线"
          :items="lineOptions"
          value-key="value"
          :loading="lineChoiceStatus === 'pending'"
          :search-input="{ placeholder: '搜索产品线名称或编码' }"
          placeholder="全部产品线"
          class="w-full"
        />
      </UFormField>
      <UFormField label="管理状态" name="status" class="min-w-0 flex-1 basis-32">
        <USelect v-model="workspaceStatus" :items="statusOptions" class="w-full" />
      </UFormField>
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        @click="resetFilters"
      >
        重置
      </UButton>
    </form>
    <UAlert v-if="errorAlert" v-bind="errorAlert" />
    <UAlert v-if="lineChoiceAlert" v-bind="lineChoiceAlert" />
    <UAlert v-if="lineChoices?.truncated" color="warning" title="产品线选项未全部加载，请刷新重试或使用产品搜索。" />
    <UAlert
      v-if="!hosted && ready && !catalog?.catalog_generation"
      color="info"
      variant="soft"
      icon="i-lucide-info"
      title="产品目录尚未刷新"
      description="已有空间仍可按产品编码查看。请由具备产品接入权限的管理员刷新目录，以显示最新产品名称和产品线。"
    />
    <UAlert
      v-if="ready && data?.truncated"
      color="warning"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="产品线过多，仅显示部分"
      :description="`共 ${data?.total || 0} 条产品线，当前只加载了 ${lines.length} 条。请用搜索或产品线筛选缩小范围。`"
    />
    <div v-if="!hosted && ready && catalog?.catalog_updated_at" class="text-xs text-muted">
      产品目录更新于 {{ formatDateTime(catalog.catalog_updated_at) }}
    </div>

    <div class="min-w-0 overflow-x-auto rounded-lg border border-default">
      <!-- 名称列需要足够宽度，否则窄屏下会把产品名挤成逐字竖排；表格自身横向滚动。 -->
      <table v-if="status === 'pending' || lines.length" class="w-full min-w-[50rem] text-sm">
        <thead>
          <tr class="border-b border-default bg-elevated">
            <th class="min-w-64 px-4 py-2.5 text-left font-medium">
              产品线 → 产品
            </th>
            <th class="w-48 px-4 py-2.5 text-left font-medium whitespace-nowrap">
              编码
            </th>
            <th class="w-28 px-4 py-2.5 text-left font-medium whitespace-nowrap">
              管理状态
            </th>
            <th class="w-44 px-4 py-2.5 text-left font-medium whitespace-nowrap">
              管理
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="status === 'pending'">
            <td colspan="4" class="px-4 py-6 text-center text-muted">
              正在加载产品线…
            </td>
          </tr>
          <template
            v-for="line in lines"
            :key="lineKey(line)"
          >
            <!-- 产品线行 -->
            <tr
              class="cursor-pointer border-b border-default hover:bg-elevated"
              @click="toggleLine(line)"
            >
              <td class="px-4 py-2.5">
                <div class="flex flex-wrap items-center gap-2">
                  <UIcon
                    :name="expanded.has(lineKey(line)) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    class="h-4 w-4 shrink-0 text-muted"
                  />
                  <UIcon
                    name="i-lucide-folder"
                    class="h-4 w-4 shrink-0 text-primary"
                  />
                  <span class="font-semibold">{{ line.label || line.line_code || '未分类' }}</span>
                  <UBadge
                    v-if="line.management_product_code"
                    color="info"
                    variant="subtle"
                    size="xs"
                  >
                    {{ line.status === 'archived' ? '统一管理已归档' : '统一产品管理' }}
                  </UBadge>
                  <UBadge
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    {{ line.total }} 个产品
                  </UBadge>
                </div>
              </td>
              <td class="px-4 py-2.5 text-xs text-muted whitespace-nowrap">
                {{ line.line_code || '未分类' }}
              </td>
              <td class="px-4 py-2.5">
                <UBadge
                  v-if="line.status"
                  :color="statusMeta[line.status]?.color || 'neutral'"
                  variant="subtle"
                  size="xs"
                >
                  {{ statusMeta[line.status]?.label || line.status }}
                </UBadge>
              </td>
              <td class="px-4 py-2.5">
                <UButton
                  v-if="line.management_product_code"
                  :to="moduleUrl(`/products/${encodeURIComponent(line.management_product_code)}`)"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click.stop
                >
                  进入统一管理
                </UButton>
                <UButton
                  v-else-if="line.can_unify && globalPermissions?.onboard"
                  size="xs"
                  variant="soft"
                  @click.stop="lineOnboardForm?.selectLine(line)"
                >
                  启用统一产品管理
                </UButton>
                <span v-else class="text-xs text-muted">展开查看产品管理状态</span>
              </td>
            </tr>

            <!-- 产品线下的产品 -->
            <template v-if="expanded.has(lineKey(line))">
              <tr v-if="children[lineKey(line)]?.status === 'pending'" class="border-b border-default">
                <td colspan="4" class="px-4 py-3 pl-14 text-xs text-muted">
                  正在加载产品…
                </td>
              </tr>
              <tr v-else-if="children[lineKey(line)]?.status === 'error'" class="border-b border-default">
                <td colspan="4" class="px-4 py-3 pl-14">
                  <div class="flex flex-wrap items-center gap-3">
                    <span class="text-xs text-error">{{ children[lineKey(line)]?.message }}</span>
                    <UButton
                      color="neutral"
                      variant="outline"
                      size="xs"
                      @click.stop="loadChildren(line)"
                    >
                      重新加载产品
                    </UButton>
                  </div>
                </td>
              </tr>
              <tr v-else-if="!children[lineKey(line)]?.items.length" class="border-b border-default">
                <td colspan="4" class="px-4 py-3 pl-14 text-xs text-muted">
                  当前筛选下没有产品
                </td>
              </tr>
              <tr
                v-for="item in children[lineKey(line)]?.items || []"
                :key="item.product_code"
                class="border-b border-default hover:bg-elevated"
              >
                <td class="px-4 py-2.5">
                  <div class="flex flex-wrap items-center gap-2 pl-10">
                    <NuxtLink
                      v-if="item.status !== 'not_enabled'"
                      :to="productTarget(item)"
                      class="font-medium text-primary hover:underline"
                    >
                      {{ item.product_name || item.product_code }}
                    </NuxtLink>
                    <span v-else class="font-medium">{{ item.product_name || item.product_code }}</span>
                    <UBadge
                      v-if="item.component_id"
                      color="info"
                      variant="subtle"
                      size="xs"
                    >
                      统一管理 · 功能模块
                    </UBadge>
                  </div>
                </td>
                <td class="px-4 py-2.5 text-xs text-muted whitespace-nowrap">
                  {{ item.product_code }}
                </td>
                <td class="px-4 py-2.5">
                  <UBadge
                    :color="statusMeta[item.status]?.color || 'neutral'"
                    variant="subtle"
                    size="xs"
                  >
                    {{ statusMeta[item.status]?.label || item.status }}
                  </UBadge>
                </td>
                <td class="px-4 py-2.5">
                  <UButton
                    v-if="item.status !== 'not_enabled'"
                    :to="productTarget(item)"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                  >
                    {{ item.component_id ? '查看模块' : item.status === 'archived' ? '查看已归档产品' : '进入管理' }}
                  </UButton>
                  <!-- 统一空间只拥有已纳入的模块，未纳入的产品仍可自行启用管理。 -->
                  <UButton
                    v-else-if="globalPermissions?.onboard"
                    size="xs"
                    variant="soft"
                    @click.stop="onboardForm?.selectProduct(item)"
                  >
                    启用产品管理
                  </UButton>
                  <span v-else class="text-xs text-muted">未启用</span>
                </td>
              </tr>
              <tr v-if="children[lineKey(line)]?.truncated" class="border-b border-default">
                <td colspan="4" class="px-4 py-3 pl-14 text-xs text-warning">
                  该产品线共 {{ children[lineKey(line)]?.total }} 个产品，当前只加载了 {{ children[lineKey(line)]?.items.length }} 个，请用搜索缩小范围。
                </td>
              </tr>
            </template>
          </template>
        </tbody>
      </table>
      <CommonEmptyState
        v-else
        class="px-4 py-6"
        :title="error ? '暂时无法显示产品线' : '没有符合条件的产品线'"
        description="可以重置筛选或刷新目录。"
        icon="i-lucide-folder-tree"
      />
    </div>
    <p v-if="ready" class="text-sm text-muted">
      共 {{ data?.total || 0 }} 条产品线
    </p>
  </div>
</template>
