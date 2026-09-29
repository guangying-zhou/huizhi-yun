<script setup lang="ts">
import CommonEmptyState from '../../../foundation/app/components/common/EmptyState.vue'
import AssetCategoryEditModal from '../../app/components/assets/AssetCategoryEditModal.vue'
import { normalizeAssetCategoryGroups } from '../../app/utils/assetCategories'
import type { ApiResponse, AssetCategoryGroup } from '../../app/types'
import { useAssetsModule } from '../useAssetsModule'

definePageMeta({ hostContentInset: false })
const route = useRoute()
const { moduleUrl, cacheKey } = useAssetsModule()
const categoryId = Number(route.params.id || 0)
const editing = Boolean(route.params.id)
const mode = route.query.mode === 'items' ? 'items' : 'category'
const fallback = moduleUrl('/admin/asset-categories')
const returnPath = computed(() => {
  const value = typeof route.query.returnTo === 'string' ? route.query.returnTo : ''
  return value.split(/[?#]/)[0] === fallback ? value : fallback
})
const { data, pending, error, refresh } = await useFetch<ApiResponse<{ items: AssetCategoryGroup[] }>>(moduleUrl('/api/v1/admin/asset-categories'), { key: cacheKey('product-category-form'), query: { scope: 'product', pageSize: 500 } })
const category = computed(() => normalizeAssetCategoryGroups(data.value?.data.items, 'product').find(item => item.id === categoryId) || null)
const leave = () => navigateTo(returnPath.value)
</script>

<template>
  <UDashboardPanel id="asset-category-form" :ui="{ body: 'p-0 sm:p-0' }">
    <template #body>
      <div v-if="pending" class="p-4 sm:p-6">
        <USkeleton class="h-48 w-full" />
      </div>
      <CommonEmptyState
        v-else-if="error || editing && !category"
        icon="i-lucide-circle-alert"
        title="无法加载产品类别"
        description="请检查访问权限或稍后重试。"
      >
        <UButton color="neutral" variant="outline" @click="leave">
          返回
        </UButton>
        <UButton @click="refresh">
          重试
        </UButton>
      </CommonEmptyState>
      <AssetCategoryEditModal
        v-else
        :open="true"
        page
        scope="product"
        :category="editing ? category : null"
        :mode="editing ? mode : 'create'"
        @update:open="leave"
        @saved="leave"
      />
    </template>
  </UDashboardPanel>
</template>
