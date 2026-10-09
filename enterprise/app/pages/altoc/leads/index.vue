<script setup lang="ts">
import AltocSalesPage from '../../../components/AltocSalesPage.vue'

definePageMeta({ name: 'altoc-host-leads', layout: 'enterprise', navigationOwner: 'altoc', logicalModule: 'altoc' })
</script>

<template>
  <AltocSalesPage
    resource="lead"
    title="线索"
  />
</template>
