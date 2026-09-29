<script setup lang="ts">
import ProductsVersionTools from '../../../components/products/VersionTools.vue'
import ProductsVersionPicker from '../../../components/products/VersionPicker.vue'
import ProductsVersionDeliverySummary from '../../../components/products/VersionDeliverySummary.vue'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '跨版本项目汇总', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
type Version = { id: number, product_code: string, version_code: string, name: string | null, status: string, revision: number }
const selected = ref<Version | null>(null)
watch(code, () => {
  selected.value = null
})
</script>

<template>
  <div class="mx-auto min-w-0 max-w-6xl space-y-4 p-4 sm:p-6">
    <ProductsVersionTools :product-code="code" />
    <h1 class="text-lg font-semibold">
      跨版本项目汇总
    </h1>
    <p class="text-sm text-muted">
      切换版本查看其执行项目。日常安排交付请进入具体版本的「研发交付」。
    </p>
    <ProductsVersionPicker v-model="selected" :product-code="code" include-published />
    <CommonEmptyState
      v-if="!selected"
      icon="i-lucide-network"
      title="尚未选择版本"
      description="选择版本查看跨项目执行情况。"
    />
    <ProductsVersionDeliverySummary
      v-else
      :key="`${code}:${selected.id}`"
      :product-code="code"
      :version-id="selected.id"
    />
  </div>
</template>
