<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'
import { useProductWorkspace } from '../../composables/useProductWorkspace'
import {
  getProductPerspectives,
  productNavTo,
  resolveProductPerspective,
  productNavItemMatches,
  type ProductNavItem
} from '../../../layer/productNavigation'

const { moduleUrl } = useAimsModule()

const props = defineProps<{ productCode: string }>()

const route = useRoute()
const code = computed(() => props.productCode)
const { product, displayName, productLineLabel } = useProductWorkspace(code)

const perspectives = computed(() => getProductPerspectives(code.value))
const activeKey = computed(() => resolveProductPerspective(perspectives.value, route.path, route.query.view))
const activePerspective = computed(() => perspectives.value.find(item => item.key === activeKey.value) || null)

const tabs = computed(() => perspectives.value.map(perspective => ({
  key: perspective.key,
  label: perspective.label,
  icon: perspective.icon,
  audience: perspective.audience,
  to: perspective.key === 'overview' || perspective.key === 'settings'
    ? { path: perspective.path }
    : productNavTo(perspectives.value, perspective.key, perspective.path)
})))

function itemActive(item: ProductNavItem) {
  return productNavItemMatches(route.path, item)
}
function itemTo(item: ProductNavItem) {
  return productNavTo(perspectives.value, activeKey.value || 'rd', item.path)
}
const subItems = computed(() => (activePerspective.value?.items || []).map(item => ({ ...item, active: itemActive(item), to: itemTo(item) })))
const moreItems = computed(() => (activePerspective.value?.more || []).map(item => ({ ...item, active: itemActive(item), to: itemTo(item) })))
const moreActive = computed(() => moreItems.value.some(item => item.active))
const moreMenu = computed(() => [moreItems.value.map(item => ({ label: item.label, icon: item.icon, to: item.to }))])

// 产品切换器：按需读取，避免每个产品页都拉一次产品列表
const switcherOpen = ref(false)
const { search: switcherSearch, debounced: switcherKeyword, reset: resetSwitcherSearch } = useDebouncedSearch()
type SwitcherProduct = { product_code: string, product_name: string | null, status: string }
const switcherItems = ref<SwitcherProduct[]>([])
const switcherTotal = ref(0)
const switcherLoading = ref(false)
const switcherFailed = ref(false)
let switcherGeneration = 0

async function loadSwitcher() {
  const current = ++switcherGeneration
  const keyword = switcherKeyword.value.trim()
  switcherLoading.value = true
  switcherFailed.value = false
  try {
    const response = await $fetch<{ code: number, data: { items: SwitcherProduct[], total: number } }>(moduleUrl('/api/v1/products'), {
      query: { page: 1, pageSize: 20, status: 'active', ...(keyword ? { keyword } : {}) }, timeout: 15000
    })
    if (current !== switcherGeneration) return
    if (response.code !== 0 || !Array.isArray(response.data?.items)) throw new Error('产品列表响应不完整')
    switcherItems.value = response.data.items
    switcherTotal.value = Number.isSafeInteger(response.data.total) ? response.data.total : response.data.items.length
  } catch {
    if (current !== switcherGeneration) return
    switcherItems.value = []
    switcherTotal.value = 0
    switcherFailed.value = true
  } finally {
    if (current === switcherGeneration) switcherLoading.value = false
  }
}

watch(switcherOpen, (open) => {
  if (open) loadSwitcher()
  else resetSwitcherSearch()
})
watch(switcherKeyword, () => {
  if (switcherOpen.value) loadSwitcher()
})
watch(code, () => {
  switcherOpen.value = false
})

async function switchProduct(target: string) {
  switcherOpen.value = false
  if (target === code.value) return
  // 切换产品时保留当前视角，不保留上一产品的筛选条件。
  const perspective = perspectives.value.find(item => item.key === (activeKey.value || 'overview'))
  const targetPerspectives = getProductPerspectives(target)
  const nextKey = perspective?.key || 'overview'
  const next = targetPerspectives.find(item => item.key === nextKey) || targetPerspectives[0]!
  await navigateTo(nextKey === 'overview' || nextKey === 'settings'
    ? { path: next.path }
    : productNavTo(targetPerspectives, nextKey, next.path))
}
</script>

<template>
  <div class="shrink-0 border-b border-default bg-default">
    <div class="px-4 pt-3 sm:px-6">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <div class="mb-1.5 flex flex-wrap items-center gap-2">
            <UBadge
              v-if="productLineLabel"
              color="info"
              variant="subtle"
              size="sm"
            >
              {{ productLineLabel }}
            </UBadge>
            <UBadge
              color="neutral"
              variant="outline"
              size="sm"
            >
              {{ product?.management_kind === 'product_line' ? '产品线编码: ' + product.product_line : '产品编码: ' + code }}
            </UBadge>
            <div v-if="product" class="flex items-center gap-1.5">
              <span class="inline-block size-2 rounded-full" :class="product.status === 'active' ? 'bg-success' : 'bg-neutral'" />
              <span class="text-sm font-medium">{{ product.status === 'active' ? '使用中' : '已归档' }}</span>
            </div>
          </div>

          <div class="flex min-w-0 items-center gap-1.5">
            <UPopover
              v-model:open="switcherOpen"
              :content="{ align: 'start', side: 'bottom', sideOffset: 8 }"
              :ui="{ content: 'w-[calc(100vw-2rem)] overflow-hidden rounded-2xl p-0 sm:w-96' }"
            >
              <UButton
                aria-label="切换产品"
                title="切换产品"
                icon="i-lucide-chevrons-up-down"
                color="neutral"
                variant="ghost"
                size="sm"
                square
              />
              <template #content>
                <div class="border-b border-default px-4 py-3">
                  <UInput
                    v-model="switcherSearch"
                    class="w-full"
                    icon="i-lucide-search"
                    placeholder="搜索产品名称或编码"
                    autofocus
                    size="md"
                  />
                </div>
                <div class="max-h-80 overflow-y-auto p-2">
                  <p v-if="switcherLoading" class="px-4 py-8 text-center text-sm text-muted">
                    正在加载产品…
                  </p>
                  <p v-else-if="switcherFailed" class="px-4 py-8 text-center text-sm text-muted">
                    暂时无法读取产品列表，请稍后重试。
                  </p>
                  <p v-else-if="switcherItems.length === 0" class="px-4 py-8 text-center text-sm text-muted">
                    未找到匹配产品
                  </p>
                  <button
                    v-for="item in switcherItems"
                    :key="item.product_code"
                    type="button"
                    class="flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-elevated"
                    :class="item.product_code === code ? 'bg-elevated' : ''"
                    @click="switchProduct(item.product_code)"
                  >
                    <UIcon name="i-lucide-package" class="size-4 shrink-0 text-dimmed" />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-[13px] font-medium leading-5 text-highlighted">
                        {{ item.product_name || item.product_code }}
                      </span>
                      <span class="block truncate text-[11px] leading-4 text-muted">{{ item.product_code }}</span>
                    </span>
                    <UIcon
                      v-if="item.product_code === code"
                      name="i-lucide-check"
                      class="size-4 shrink-0 text-primary"
                    />
                  </button>
                </div>
                <div class="flex items-center justify-between border-t border-default px-4 py-3 text-sm">
                  <span class="text-muted">已启用 {{ switcherTotal }} 个产品</span>
                  <UButton
                    label="前往产品中心"
                    color="neutral"
                    variant="ghost"
                    trailing-icon="i-lucide-arrow-right"
                    :to="moduleUrl('/products')"
                    @click="switcherOpen = false"
                  />
                </div>
              </template>
            </UPopover>

            <h1 class="truncate text-xl font-bold leading-tight sm:text-2xl">
              {{ displayName }}
            </h1>
          </div>

          <p v-if="product?.positioning" class="mt-1 line-clamp-1 text-sm text-muted">
            {{ product.positioning }}
          </p>
        </div>

        <div class="flex shrink-0 items-start gap-2 pt-1">
          <slot name="actions" />
        </div>
      </div>
    </div>

    <!-- 一级：工作视角 -->
    <div class="mt-2 flex items-center gap-0.5 overflow-x-auto px-4 sm:px-6">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.key"
        :to="tab.to"
        :title="tab.audience"
        :aria-current="activeKey === tab.key ? 'page' : undefined"
        class="flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors"
        :class="activeKey === tab.key ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-default'"
      >
        <UIcon :name="tab.icon" class="size-4" />
        {{ tab.label }}
      </NuxtLink>
    </div>

    <!-- 二级：视角内入口 -->
    <div v-if="subItems.length" class="flex items-center gap-1 overflow-x-auto border-t border-default bg-elevated/50 px-4 py-1.5 sm:px-6">
      <NuxtLink
        v-for="item in subItems"
        :key="item.path"
        :to="item.to"
        :aria-current="item.active ? 'page' : undefined"
        class="flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-sm transition-colors"
        :class="item.active ? 'bg-primary/10 font-medium text-primary' : 'text-muted hover:bg-accented hover:text-default'"
      >
        <UIcon :name="item.icon" class="size-4" />
        {{ item.label }}
      </NuxtLink>
      <UDropdownMenu v-if="moreItems.length" :items="moreMenu">
        <UButton
          label="更多"
          trailing-icon="i-lucide-chevron-down"
          size="sm"
          :color="moreActive ? 'primary' : 'neutral'"
          variant="ghost"
          class="rounded-full"
        />
      </UDropdownMenu>
    </div>
  </div>
</template>
