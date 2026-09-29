<script setup lang="ts">
import ProductsNavbar from '../../components/products/Navbar.vue'
import { productBasePath, productPathMatches } from '../../../layer/productNavigation'

// 产品工作台外壳：固定产品身份与工作视角导航，内容区独立滚动。
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const versionPath = computed(() => `${productBasePath(code.value)}/versions`)
const planningStep = computed(() => {
  const base = productBasePath(code.value)
  if (productPathMatches(route.path, `${base}/planning-items`) && route.path.endsWith('/handoff') && /^\d+$/.test(String(route.query.versionId || '')) && /^\d+$/.test(String(route.query.scopeId || ''))) return null
  if (productPathMatches(route.path, `${base}/cycles`)) return '安排优先级'
  if ([`${base}/planning`, `${base}/planning-items`].some(path => productPathMatches(route.path, path))) return '整理建设范围'
  return null
})
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <ProductsNavbar :product-code="code" />
    <div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div v-if="planningStep" class="flex flex-wrap items-center gap-2 border-b border-default px-4 py-2 sm:px-6">
        <UButton
          :to="versionPath"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
        >
          返回版本计划
        </UButton>
        <span class="text-sm text-muted">版本计划 / 高级规划 / {{ planningStep }}</span>
      </div>
      <NuxtPage />
    </div>
  </div>
</template>
