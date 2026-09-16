<script setup lang="ts">
definePageMeta({ layout: 'default' })
const route = useRoute()
const token = computed(() => typeof route.params.token === 'string' ? route.params.token : '')
</script>

<template>
  <PublishedAssetDocument :token="token" />
</template>
