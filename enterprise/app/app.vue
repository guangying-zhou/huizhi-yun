<script setup lang="ts">
const scope = useState<string>('enterprise-cache-scope', () => '')
</script>
<template>
  <UApp>
    <NuxtLoadingIndicator />
    <NuxtLayout><NuxtPage :page-key="route => `${scope}:${route.fullPath}`" /></NuxtLayout>
  </UApp>
</template>
