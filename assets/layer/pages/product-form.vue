<script setup lang="ts">
import CommonEmptyState from '../../../foundation/app/components/common/EmptyState.vue'
import ProductAssetCreateModal from '../../app/components/assets/ProductAssetCreateModal.vue'
import ProductAssetEditModal from '../../app/components/assets/ProductAssetEditModal.vue'
import type { ApiResponse, ProductAssetItem } from '../../app/types'
import { useAssetsModule } from '../useAssetsModule'

definePageMeta({ hostContentInset: false })
const route = useRoute()
const { moduleUrl, cacheKey } = useAssetsModule()
const productId = computed(() => String(route.params.id || ''))
const editing = computed(() => Boolean(productId.value))
const fallback = computed(() => moduleUrl(editing.value ? `/products/${encodeURIComponent(productId.value)}` : '/products'))
// Return only to the source list/detail. External and unrelated destinations are ignored.
const returnPath = computed(() => {
  const value = typeof route.query.returnTo === 'string' ? route.query.returnTo : ''
  const path = value.split(/[?#]/)[0]
  return path === fallback.value ? value : fallback.value
})
const { data, pending, error, refresh } = await useFetch<ApiResponse<ProductAssetItem>>(
  () => moduleUrl(`/api/v1/products/${encodeURIComponent(productId.value)}`),
  { key: cacheKey(`product-form:${productId.value}`), immediate: editing.value, watch: false }
)
const leave = () => navigateTo(returnPath.value)
</script>

<template>
  <UDashboardPanel id="product-form" :ui="{ body: 'p-0 sm:p-0' }">
    <template #body>
      <div v-if="editing && pending" class="p-4 sm:p-6">
        <USkeleton class="h-48 w-full" />
      </div>
      <CommonEmptyState
        v-else-if="editing && (error || !data?.data)"
        icon="i-lucide-circle-alert"
        title="无法加载产品主档"
        description="请检查访问权限或稍后重试。"
      >
        <template #default>
          <UButton color="neutral" variant="outline" @click="leave">
            返回
          </UButton>
          <UButton @click="refresh">
            重试
          </UButton>
        </template>
      </CommonEmptyState>
      <ProductAssetEditModal
        v-else-if="editing"
        :open="true"
        :product="data?.data || null"
        page
        @update:open="leave"
        @updated="leave"
      />
      <ProductAssetCreateModal
        v-else
        :open="true"
        page
        @update:open="leave"
        @created="leave"
      />
    </template>
  </UDashboardPanel>
</template>
