<script setup lang="ts">
import RemoteAssetObjectSelect from './RemoteAssetObjectSelect.vue'
import { useAssetsModule } from '../../../layer/useAssetsModule'
import { useAssetDictionaries } from '../../composables/useAssetDictionaries'
import type { ApiResponse, ProductAssetItem } from '../../types'

const { moduleUrl } = useAssetsModule()
const commandKey = ref(crypto.randomUUID())

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
const relationOptions = computed(() => getOptions('product_asset_relation_type'))
const state = reactive({
  asset_id: undefined as number | undefined,
  relation_type: 'runtime',
  is_primary: false
})

watch(state, () => {
  commandKey.value = crypto.randomUUID()
}, { deep: true, flush: 'sync' })

watch(() => props.open, async (open) => {
  if (open) {
    commandKey.value = crypto.randomUUID()
    state.asset_id = undefined
    state.relation_type = 'runtime'
    state.is_primary = false
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
    await $fetch<ApiResponse<{ id: number }>>(moduleUrl(`/api/v1/products/${props.product.id}/assets`), {
      method: 'POST',
      headers: { 'Idempotency-Key': commandKey.value },
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
          <RemoteAssetObjectSelect
            v-model="state.asset_id"
            kind="assets"
            :enabled="isOpen"
            :exclude-ids="(props.product?.linked_assets || []).map(item => item.id)"
            product-candidates
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
