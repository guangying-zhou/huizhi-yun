<script setup lang="ts">
import AltocSalesPage from '../../../components/AltocSalesPage.vue'

definePageMeta({ name: 'altoc-host-leads-detail', layout: 'enterprise', navigationOwner: 'altoc', logicalModule: 'altoc' })
</script>

<template>
  <AltocSalesPage
    resource="lead"
    title="线索详情"
    detail
  />
</template>
