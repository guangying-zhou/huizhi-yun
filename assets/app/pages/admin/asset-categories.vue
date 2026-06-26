<script setup lang="ts">
import { assetCategoryScopeDefinitions, assetCategoryScopeMap, type AssetCategoryScope } from '~~/shared/assetCategoryDefaults'
import type { ApiResponse, AssetCategoryGroup } from '~/types'
import { normalizeAssetCategoryGroups } from '~/utils/assetCategories'

const route = useRoute()
const router = useRouter()
const editOpen = ref(false)
const selectedCategory = ref<AssetCategoryGroup | null>(null)
const editorMode = ref<'create' | 'category' | 'items'>('create')

function normalizeScope(input: unknown): AssetCategoryScope {
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
const tabItems = computed(() => assetCategoryScopeDefinitions.map(item => ({
  label: item.label,
  value: item.scope
})))

const { data: response, refresh } = await useFetch<ApiResponse<{ items: AssetCategoryGroup[] }>>('/api/v1/admin/asset-categories', {
  query: computed(() => ({ scope: activeScope.value, pageSize: 500 })),
  watch: [activeScope]
})

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

async function handleSaved() {
  await refresh()
}
</script>

<template>
  <UDashboardPanel id="admin-asset-categories" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          资产类别管理
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          @click="handleCreate"
        >
          新增{{ currentScopeMeta.groupLabel }}
        </UButton>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          @click="refresh()"
        >
          刷新
        </UButton>
      </Teleport>

      <div class="p-4 space-y-4">
        <UTabs
          v-model="activeScope"
          :items="tabItems"
          variant="link"
          color="primary"
          :content="false"
        />

        <!-- <AssetsPageIntroCard
          title="资产类别管理"
          :description="currentScopeMeta.description"
        /> -->

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">{{ currentScopeMeta.groupLabel }}</span>
              <UBadge color="neutral" variant="soft">
                {{ rows.length }} 个
              </UBadge>
            </div>
          </template>

          <UTable :data="rows" :columns="columns" @select="handleRowSelect">
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
