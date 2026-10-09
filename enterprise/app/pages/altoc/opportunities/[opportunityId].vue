<script setup lang="ts">
import AltocSalesPage from '../../../components/AltocSalesPage.vue'

definePageMeta({ name: 'altoc-host-opportunities-detail', layout: 'enterprise', navigationOwner: 'altoc', logicalModule: 'altoc' })
</script>

<template>
  <AltocSalesPage
    resource="opportunity"
    title="商机详情"
    detail
  />
</template>
