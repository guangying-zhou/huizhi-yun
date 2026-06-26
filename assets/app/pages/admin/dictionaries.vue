<script setup lang="ts">
import { managedAssetCategoryDictionaryCodes } from '~~/shared/assetCategoryDefaults'
import type { AssetDictionaryDefinition } from '~~/shared/assetsDictionaries'

const editOpen = ref(false)
const selectedDictionary = ref<AssetDictionaryDefinition | null>(null)

const { dictionaries, loadDictionaries } = useAssetDictionaries()
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

const handleRowSelect = (_event: Event, row: { original: AssetDictionaryDefinition & { option_count: number } }) => {
  selectedDictionary.value = row.original
  editOpen.value = true
}

const handleUpdated = async () => {
  await loadDictionaries(true)
}
</script>

<template>
  <UDashboardPanel id="admin-dictionaries" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          字典管理
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
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
        <AssetsPageIntroCard
          title="字典管理"
          description="维护系统固定选项，资产、环境、交付、采购、预警等录入表单会直接使用这些字典项。资产大类下的分类请到“资产类别管理”单独维护。"
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

          <UTable :data="rows" :columns="columns" @select="handleRowSelect" />
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsDictionaryEditModal
    :open="editOpen"
    :dictionary="selectedDictionary"
    @update:open="editOpen = $event"
    @updated="handleUpdated"
  />
</template>
