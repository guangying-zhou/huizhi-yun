<script setup lang="ts">
import ApplicationCatalog from '../../components/console/ApplicationCatalog.vue'

definePageMeta({
  layout: 'console'
})

usePageTitle('应用中心')
</script>

<template>
  <ApplicationCatalog />
</template>
