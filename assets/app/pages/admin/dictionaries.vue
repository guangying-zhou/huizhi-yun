<script setup lang="ts">
import { managedAssetCategoryDictionaryCodes } from '../../../shared/assetCategoryDefaults'
import type { AssetDictionaryDefinition } from '../../../shared/assetsDictionaries'
import { useAssetsModule } from '../../../layer/useAssetsModule'

usePageTitle('字典管理')

const editOpen = ref(false)
const selectedDictionary = ref<AssetDictionaryDefinition | null>(null)

const { hosted } = useAssetsModule()
const { dictionaries, loadDictionaries } = useAssetDictionaries('asset-items')
await loadDictionaries()

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
  await loadDictionaries(true)
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
  await loadDictionaries(true)
}
</script>

<template>
  <UDashboardPanel id="admin-dictionaries" grow>
    <template #body>
      <div class="p-4 space-y-4">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">字典列表</span>
              <UBadge color="neutral" variant="soft">
                {{ rows.length }} 个
              </UBadge>
            </div>
          </template>

          <UTable :data="rows" :columns="columns" @select="handleRowSelect" />
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
