<script setup lang="ts">
definePageMeta({ layoutHeader: true, layoutHeaderTitle: '规划事项详情', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.itemId || ''))
</script>

<template>
  <div class="mx-auto min-w-0 max-w-5xl space-y-4 p-4 sm:p-6">
    <UButton :to="`/products/${encodeURIComponent(code)}/planning`" color="neutral" variant="ghost">
      返回高级规划
    </UButton>
    <UButton :to="`/products/${encodeURIComponent(code)}/planning-items/${encodeURIComponent(id)}/version`" color="neutral" variant="outline">
      排入产品版本
    </UButton>
    <UButton :to="`/products/${encodeURIComponent(code)}/planning-items/${encodeURIComponent(id)}/roadmap`" color="neutral" variant="outline">
      探索时间窗口
    </UButton>
    <UButton :to="`/products/${encodeURIComponent(code)}/planning-items/${encodeURIComponent(id)}/dependencies`" color="neutral" variant="outline">
      跨产品依赖
    </UButton>
    <UButton :to="'/products/' + encodeURIComponent(code) + '/planning-items/' + encodeURIComponent(id) + '/reach'" color="neutral" variant="outline">
      Reach 观测历史
    </UButton>
    <ProductsPlanningItemDetail :key="`${code}:${id}`" :product-code="code" :item-id="id" />
    <ProductsPlanningComments :key="`comments:${code}:${id}`" :product-code="code" :item-id="id" />
  </div>
</template>
