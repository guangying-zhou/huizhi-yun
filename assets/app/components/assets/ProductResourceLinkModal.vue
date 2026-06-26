<script setup lang="ts">
import type { ApiResponse, AssetListItem, ListPayload, ProductAssetItem } from '~/types'

const props = defineProps<{
  open: boolean
  product: ProductAssetItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const { loadDictionaries, getOptions } = useAssetDictionaries()
await loadDictionaries()

const toast = useToast()
const submitting = ref(false)
const loadingAssets = ref(false)
const assetOptions = ref<Array<{ label: string, value: number }>>([])
const relationOptions = computed(() => getOptions('product_asset_relation_type'))
const state = reactive({
  asset_id: undefined as number | undefined,
  relation_type: 'runtime',
  is_primary: false
})

async function loadAssets() {
  loadingAssets.value = true

  try {
    const response = await $fetch<ApiResponse<ListPayload<AssetListItem>>>('/api/v1/assets')
    const linkedIds = new Set((props.product?.linked_assets || []).map(item => item.id))
    assetOptions.value = (response.data.items || [])
      .filter(item => !linkedIds.has(item.id))
      .map(item => ({ label: `${item.asset_code} · ${item.asset_name}`, value: item.id }))
  } catch (error) {
    console.error('[ProductResourceLink] Failed to load assets:', error)
    toast.add({ title: '资产加载失败', description: '请刷新后重试。', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    loadingAssets.value = false
  }
}

watch(() => props.open, async (open) => {
  if (open) {
    state.asset_id = undefined
    state.relation_type = 'runtime'
    state.is_primary = false
    await loadAssets()
  }
})

async function handleSubmit() {
  if (!props.product?.id) {
    return
  }

  if (!state.asset_id) {
    toast.add({ title: '缺少资产', description: '请先选择要关联的资产。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    await $fetch<ApiResponse<{ id: number }>>(`/api/v1/products/${props.product.id}/assets`, {
      method: 'POST',
      body: {
        asset_id: state.asset_id,
        relation_type: state.relation_type,
        is_primary: state.is_primary
      }
    })

    toast.add({ title: '资源已关联', description: '产品与资产关系已保存。', color: 'success', icon: 'i-lucide-check' })
    emit('created')
    isOpen.value = false
  } catch (error) {
    console.error('[ProductResourceLink] Failed:', error)
    toast.add({ title: '关联失败', description: '可能已存在相同关联。', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="关联产品资源"
    description="把运行资源、交付资源或研发支撑资产挂到当前产品。"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="选择资产" required>
          <USelectMenu
            v-model="state.asset_id"
            :items="assetOptions"
            :loading="loadingAssets"
            value-key="value"
            placeholder="请选择资源资产"
            searchable
          />
        </UFormField>

        <UFormField label="关联类型">
          <USelect
            v-model="state.relation_type"
            :items="relationOptions"
            class="w-full"
          />
        </UFormField>

        <UCheckbox v-model="state.is_primary" label="设为主关联资源" />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          取消
        </UButton>
        <UButton :loading="submitting" icon="i-lucide-link-2" @click="handleSubmit">
          确认关联
        </UButton>
      </div>
    </template>
  </UModal>
</template>
