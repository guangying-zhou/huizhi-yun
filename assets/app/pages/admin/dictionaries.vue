<script setup lang="ts">
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import { managedAssetCategoryDictionaryCodes } from '../../../shared/assetCategoryDefaults'
import type { AssetDictionaryDefinition } from '../../../shared/assetsDictionaries'
import { useAssetsModule } from '../../../layer/useAssetsModule'

definePageMeta({ hostContentInset: false })

usePageTitle('字典管理')

const editOpen = ref(false)
const selectedDictionary = ref<AssetDictionaryDefinition | null>(null)

const { hosted } = useAssetsModule()
const { dictionaries, loadDictionaries } = useAssetDictionaries('asset-items')
const loading = ref(false)
async function refreshDictionaries(force = false) {
  loading.value = true
  try {
    await loadDictionaries(force)
  } finally {
    loading.value = false
  }
}
await refreshDictionaries()

const items = computed<AssetDictionaryDefinition[]>(() => Object.values(dictionaries.value)
  .filter(item => !managedAssetCategoryDictionaryCodes.includes(item.code)))

const columns = [
  { accessorKey: 'name', header: '字典名称' },
  { accessorKey: 'code', header: '编码' },
  { accessorKey: 'description', header: '说明' },
  { accessorKey: 'option_count', header: '项数' }
]

const rows = computed(() => items.value.map(item => ({
  ...item,
  option_count: item.options.length
})))

const handleRefresh = async () => {
  await refreshDictionaries(true)
}
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(handleRefresh))
onBeforeUnmount(clearRefresh)

const handleRowSelect = (_event: Event, row: { original: AssetDictionaryDefinition & { option_count: number } }) => {
  if (!hosted) {
    selectedDictionary.value = row.original
    editOpen.value = true
  }
}

const handleUpdated = async () => {
  await refreshDictionaries(true)
}
</script>

<template>
  <UDashboardPanel id="admin-dictionaries" grow>
    <template #body>
      <div class="space-y-4 p-4 sm:p-6">
        <ContentPageHeader
          :hosted="hosted"
          title="资产字典"
          description="查看当前企业资产字典及其选项数量。"
          breadcrumb="控制台 / 业务配置"
        />
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">字典列表</span>
              <UBadge color="neutral" variant="soft">
                {{ rows.length }} 个
              </UBadge>
            </div>
          </template>

          <UTable
            :data="rows"
            :columns="columns"
            :loading="loading"
            @select="handleRowSelect"
          >
            <template #empty>
              <CommonEmptyState title="暂无记录" description="当前范围内没有可显示的记录。" />
            </template>
          </UTable>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsDictionaryEditModal
    v-if="!hosted"
    :open="editOpen"
    :dictionary="selectedDictionary"
    @update:open="editOpen = $event"
    @updated="handleUpdated"
  />
</template>
