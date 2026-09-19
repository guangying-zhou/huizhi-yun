<script setup lang="ts">
const route = useRoute()
const moduleCode = String(route.meta.logicalModule || '')
const entryPath = String(route.meta.moduleEntryPath || '/products')
const target = ['aims', 'assets'].includes(moduleCode) && /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(entryPath)
  ? `/${moduleCode}${entryPath}`
  : ''
if (target) await navigateTo({ path: target, query: route.query, hash: route.hash }, { replace: true })
</script>

<template>
  <section class="space-y-4">
    <h1 class="text-2xl font-semibold">{{ route.meta.moduleLabel }}</h1>
    <NuxtLink v-if="target" :to="target">进入模块</NuxtLink>
  </section>
</template>
