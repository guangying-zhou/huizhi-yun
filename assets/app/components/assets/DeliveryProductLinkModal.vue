<script setup lang="ts">
import type { ApiResponse, DeliveryItem, ListPayload, ProductAssetItem } from '~/types'

const props = defineProps<{
  open: boolean
  delivery: DeliveryItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const toast = useToast()
const submitting = ref(false)
const loadingProducts = ref(false)
const productOptions = ref<Array<{ label: string, value: number }>>([])
const relationOptions = [
  { label: '交付产品', value: 'delivered_product' },
  { label: '支撑产品', value: 'supporting_product' },
  { label: '集成产品', value: 'integrated_product' }
]

const state = reactive({
  product_asset_id: undefined as number | undefined,
  relation_type: 'delivered_product'
})

async function loadProducts() {
  loadingProducts.value = true

  try {
    const response = await $fetch<ApiResponse<ListPayload<ProductAssetItem>>>('/api/v1/products')
    const linkedIds = new Set((props.delivery?.linked_products || []).map(item => item.id))
    productOptions.value = (response.data.items || [])
      .filter(item => !linkedIds.has(item.id))
      .map(item => ({ label: `${item.product_code} · ${item.product_name}`, value: item.id }))
  } catch (error) {
    console.error('[DeliveryProductLink] Failed to load products:', error)
    toast.add({ title: '产品加载失败', description: '请刷新后重试。', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    loadingProducts.value = false
  }
}

watch(() => props.open, async (open) => {
  if (open) {
    state.product_asset_id = undefined
    state.relation_type = 'delivered_product'
    await loadProducts()
  }
})

async function handleSubmit() {
  if (!props.delivery?.id) {
    return
  }

  if (!state.product_asset_id) {
    toast.add({ title: '缺少产品', description: '请先选择要关联的产品。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    await $fetch<ApiResponse<{ id: number }>>(`/api/v1/deliveries/${props.delivery.id}/products`, {
      method: 'POST',
      body: {
        product_asset_id: state.product_asset_id,
        relation_type: state.relation_type
      }
    })

    toast.add({ title: '产品已关联', description: '交付与产品关系已保存。', color: 'success', icon: 'i-lucide-check' })
    emit('created')
    isOpen.value = false
  } catch (error) {
    console.error('[DeliveryProductLink] Failed:', error)
    toast.add({ title: '关联失败', description: '可能已存在相同关联。', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="关联交付产品"
    description="将产品资产挂到当前交付视图，建立客户交付与产品家底的关系。"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="产品资产" required>
          <USelectMenu
            v-model="state.product_asset_id"
            :items="productOptions"
            :loading="loadingProducts"
            value-key="value"
            searchable
            placeholder="请选择产品资产"
          />
        </UFormField>

        <UFormField label="关联类型">
          <USelect
            v-model="state.relation_type"
            :items="relationOptions"
            class="w-full"
          />
        </UFormField>
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
