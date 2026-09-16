<script setup lang="ts">
import type { ProductPlanningDetail } from '~/types/productPlanning'
import type { ProductRequestRecord } from '~/types/productRequest'

const props = defineProps<{ productCode: string, itemId: string }>()
const emit = defineEmits<{ saved: [], cancel: [] }>()
const controller = new AbortController()
onBeforeUnmount(() => controller.abort())
const item = ref<ProductPlanningDetail | null>(null), sources = ref<ProductRequestRecord[]>([])
const loading = ref(false), error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '编辑数据加载失败' })
async function load() {
  if (loading.value) return
  loading.value = true
  error.value = null
  item.value = null
  try {
    const result = await $fetch<{ code: number, data: ProductPlanningDetail }>(`/api/v1/products/${encodeURIComponent(props.productCode)}/planning-items/${props.itemId}`, { signal: controller.signal, timeout: 15000 })
    const detail = result.data
    if (result.code !== 0 || detail?.biz_id !== props.itemId || detail.product_code !== props.productCode || typeof detail.requires_impact_note !== 'boolean' || !Array.isArray(detail.requests) || detail.requests.length > 100 || !['proposed', 'in_delivery'].includes(detail.lifecycle)) throw new Error('事项不可编辑或详情不完整')
    const loaded: ProductRequestRecord[] = []
    for (let start = 0; start < detail.requests.length; start += 4) {
      const group = await Promise.all(detail.requests.slice(start, start + 4).map(async (source) => {
        const response = await $fetch<{ code: number, data: ProductRequestRecord }>(`/api/v1/products/${encodeURIComponent(props.productCode)}/requests/${source.biz_id}`, { signal: controller.signal, timeout: 15000 })
        if (response.code !== 0 || response.data?.biz_id !== source.biz_id || response.data.product_code !== props.productCode || response.data.revision !== source.revision) throw new Error('来源需求已变化或无法查看，请刷新后重新核对')
        return response.data
      }))
      loaded.push(...group)
    }
    sources.value = loaded
    item.value = detail
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('编辑数据加载失败')
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<template>
  <ProductsPlanningItemForm
    v-if="item"
    :product-code="productCode"
    :workspace-revision="item.workspace_revision"
    :item="item"
    :initial-sources="sources"
    @saved="emit('saved')"
    @cancel="emit('cancel')"
  />
  <div v-else class="space-y-3">
    <p v-if="loading" role="status" class="text-sm text-muted">
      正在读取事项与关联来源…
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <div class="flex gap-2">
      <UButton
        v-if="error"
        color="neutral"
        variant="outline"
        @click="load"
      >
        重新读取
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        @click="emit('cancel')"
      >
        取消
      </UButton>
    </div>
  </div>
</template>
