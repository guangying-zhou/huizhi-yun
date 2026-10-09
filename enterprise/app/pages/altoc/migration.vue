<script setup lang="ts">
import W3MigrationQueuePage from '../../../../finance/app/components/host/W3MigrationQueuePage.vue'

definePageMeta({ name: 'altoc-host-migration', navigationOwner: 'altoc', logicalModule: 'altoc', layout: 'enterprise', hostContentInset: false })
</script>

<template>
  <W3MigrationQueuePage app="altoc" />
</template>
