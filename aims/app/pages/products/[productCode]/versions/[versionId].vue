<script setup lang="ts">
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const versionId = computed(() => String(route.params.versionId || ''))
</script>

<template>
  <div class="min-h-0 min-w-0">
    <ProductsVersionWorkflowNav :key="`${code}:${versionId}`" :product-code="code" :version-id="versionId" />
    <NuxtPage />
  </div>
</template>
