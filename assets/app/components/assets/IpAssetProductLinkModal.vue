<script setup lang="ts">
import type { ApiResponse, IpAssetItem, ListPayload, ProductAssetItem } from '../../types'
import { useAssetsModule } from '../../../layer/useAssetsModule'

const props = defineProps<{ open: boolean, asset: IpAssetItem | null }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const toast = useToast()
const { moduleUrl } = useAssetsModule()
const submitting = ref(false)
const loadingProducts = ref(false)
const productOptions = ref<Array<{ label: string, value: number }>>([])
const submissionKey = ref('')
const state = reactive({ product_asset_id: undefined as number | undefined })

async function loadProducts() {
  loadingProducts.value = true
  try {
    const response = await $fetch<ApiResponse<ListPayload<ProductAssetItem>>>(moduleUrl('/api/v1/products?pageSize=100'))
    const linkedIds = new Set((props.asset?.linked_products || []).map(item => item.id))
    productOptions.value = (response.data.items || []).filter(item => !linkedIds.has(item.id)).map(item => ({
      label: `${item.product_code} · ${item.product_name}`,
      value: item.id
    }))
  } catch (error) {
    console.error('[IpAssetProductLink] Failed to load products:', error)
    toast.add({ title: '产品加载失败', description: '请刷新后重试。', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    loadingProducts.value = false
  }
}

watch(() => props.open, async (open) => {
  if (open) {
    state.product_asset_id = undefined
    submissionKey.value = ''
    await loadProducts()
  }
})
watch(() => state.product_asset_id, () => {
  submissionKey.value = ''
})

async function handleSubmit() {
  if (!props.asset?.id) return
  if (!state.product_asset_id) {
    toast.add({ title: '缺少产品', description: '请先选择要关联的产品。', color: 'warning' })
    return
  }
  submitting.value = true
  try {
    await $fetch<ApiResponse<{ id: number }>>(moduleUrl(`/api/v1/ip-assets/${props.asset.id}/products`), {
      method: 'POST',
      headers: { 'Idempotency-Key': submissionKey.value ||= crypto.randomUUID() },
      body: { product_asset_id: state.product_asset_id }
    })
    toast.add({ title: '产品已关联', description: '知识产权与产品关系已保存。', color: 'success', icon: 'i-lucide-check' })
    emit('created')
    isOpen.value = false
  } catch (error) {
    console.error('[IpAssetProductLink] Failed:', error)
    const status = Number((error as { statusCode?: number, response?: { status?: number } }).statusCode || (error as { response?: { status?: number } }).response?.status)
    toast.add({ title: status === 409 ? '产品已关联' : '关联失败', description: status === 409 ? '该知识产权与产品的关系已存在，请刷新详情页。' : '请检查目标权限或稍后用同一操作重试。', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="关联产品"
    description="将知识产权挂到产品资产，建立权利和产品家底关系。"
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
