<script setup lang="ts">
import { useAssetDictionaries } from '../../composables/useAssetDictionaries'
import { useAssetsModule } from '../../../layer/useAssetsModule'
import AssetsAssetCategoryEditModal from '../../components/assets/AssetCategoryEditModal.vue'

import { assetCategoryScopeDefinitions, assetCategoryScopeMap, type AssetCategoryScope } from '../../../shared/assetCategoryDefaults'
import type { ApiResponse, AssetCategoryGroup } from '../../types'
import { normalizeAssetCategoryGroups } from '../../utils/assetCategories'

const { moduleUrl, cacheKey, hosted } = useAssetsModule()

usePageTitle('资产类别管理')

const route = useRoute()
const router = useRouter()
const editOpen = ref(false)
const selectedCategory = ref<AssetCategoryGroup | null>(null)
const editorMode = ref<'create' | 'category' | 'items'>('create')

function normalizeScope(input: unknown): AssetCategoryScope {
  if (hosted) return 'product'
  return typeof input === 'string' && input in assetCategoryScopeMap
    ? input as AssetCategoryScope
    : 'physical'
}

const activeScope = ref<AssetCategoryScope>(normalizeScope(route.query.scope))

watch(activeScope, async (scope) => {
  const nextQuery = { ...route.query, scope }
  await router.replace({ query: nextQuery })
})

watch(() => route.query.scope, (scope) => {
  const nextScope = normalizeScope(scope)
  if (nextScope !== activeScope.value) {
    activeScope.value = nextScope
  }
})

const currentScopeMeta = computed(() => assetCategoryScopeMap[activeScope.value])
const tabItems = computed(() => assetCategoryScopeDefinitions.filter(item => !hosted || item.scope === 'product').map(item => ({
  label: item.label,
  value: item.scope
})))

const { data: response, refresh, error, status } = await useFetch<ApiResponse<{ items: AssetCategoryGroup[] }>>(moduleUrl('/api/v1/admin/asset-categories'), {
  key: cacheKey('product-category-management'),
  query: computed(() => ({ scope: activeScope.value, pageSize: 500 })),
  watch: [activeScope]
})
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)

const items = computed(() => normalizeAssetCategoryGroups(response.value?.data.items, activeScope.value))
const rows = computed(() => items.value.map(item => ({
  ...item,
  details_summary: (item.items || []).map(detail => detail.label).join('、'),
  item_count: (item.items || []).length,
  status_label: item.enabled ? '启用' : '停用'
})))

const columns = computed(() => [
  { accessorKey: 'label', header: `${currentScopeMeta.value.groupLabel}名称` },
  // { accessorKey: 'value', header: '值' },
  { accessorKey: 'details_summary', header: currentScopeMeta.value.itemLabel, size: 300 },
  { accessorKey: 'item_count', header: '细类数', meta: {
    class: {
      th: 'w-20 text-right', // Sets width for the header
      td: 'w-20 text-right' // Sets width for the data cell
    }
  }
  },
  { accessorKey: 'status_label', header: '状态', meta: {
    class: {
      th: 'w-16', // Sets width for the header
      td: 'w-16 text-center' // Sets width for the data cell
    }
  } },
  { accessorKey: 'actions', header: '操作' }
])

function handleCreate() {
  selectedCategory.value = null
  editorMode.value = 'create'
  editOpen.value = true
}

function handleRowSelect(_event: Event, row: { original: AssetCategoryGroup & { details_summary: string, item_count: number, status_label: string } }) {
  selectedCategory.value = row.original
  editorMode.value = 'category'
  editOpen.value = true
}

function handleEditCategory(category: AssetCategoryGroup) {
  selectedCategory.value = category
  editorMode.value = 'category'
  editOpen.value = true
}

function handleEditItems(category: AssetCategoryGroup) {
  selectedCategory.value = category
  editorMode.value = 'items'
  editOpen.value = true
}

const { loadDictionaries } = useAssetDictionaries()
async function handleSaved() {
  await loadDictionaries(true)
  await refresh()
}
</script>

<template>
  <UDashboardPanel id="admin-asset-categories" grow>
    <template #body>
      <div class="p-4 space-y-4">
        <UTabs
          v-model="activeScope"
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
              <UButton
                icon="i-lucide-plus"
                color="primary"
                variant="soft"
                :disabled="Boolean(error) || status === 'pending'"
                @click="handleCreate"
              >
                新增{{ currentScopeMeta.groupLabel }}
              </UButton>
            </div>
          </template>
        </UTabs>

        <UAlert
          v-if="error"
          color="error"
          title="无法加载产品线"
          :description="error.message"
        />
        <UCard v-else>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">{{ currentScopeMeta.groupLabel }}</span>
              <UBadge color="neutral" variant="soft">
                {{ rows.length }} 个
              </UBadge>
            </div>
          </template>

          <UTable
            :data="rows"
            :columns="columns"
            :loading="status === 'pending'"
            @select="handleRowSelect"
          >
            <template #details_summary-cell="{ row }">
              <div v-if="currentScopeMeta.itemsSupported" class="flex flex-wrap gap-2 py-1">
                <UBadge
                  v-for="item in row.original.items"
                  :key="item.id"
                  :color="item.enabled ? 'primary' : 'neutral'"
                  variant="soft"
                >
                  {{ item.label }}
                </UBadge>
              </div>
              <span v-else class="text-sm text-muted">不适用</span>
            </template>

            <template #item_count-cell="{ row }">
              <span v-if="currentScopeMeta.itemsSupported">{{ row.original.item_count }}</span>
              <span v-else class="text-sm text-muted">-</span>
            </template>

            <template #actions-cell="{ row }">
              <div class="flex items-center gap-2" @click.stop>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-pencil"
                  @click="handleEditCategory(row.original)"
                >
                  编辑{{ currentScopeMeta.groupLabel }}
                </UButton>
                <UButton
                  v-if="currentScopeMeta.itemsSupported"
                  size="xs"
                  color="primary"
                  variant="soft"
                  icon="i-lucide-list-tree"
                  @click="handleEditItems(row.original)"
                >
                  编辑{{ currentScopeMeta.itemLabel }}
                </UButton>
              </div>
            </template>
          </UTable>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsAssetCategoryEditModal
    :open="editOpen"
    :category="selectedCategory"
    :mode="editorMode"
    :scope="selectedCategory?.scope || activeScope"
    @update:open="editOpen = $event"
    @saved="handleSaved"
  />
</template>
