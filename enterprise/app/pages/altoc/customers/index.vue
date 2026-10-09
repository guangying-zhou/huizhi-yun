<script setup lang="ts">
import AltocCustomersPage from '../../../components/AltocCustomersPage.vue'

definePageMeta({ name: 'altoc-host-customers', navigationOwner: 'altoc', logicalModule: 'altoc', layout: 'enterprise', hostContentInset: false })
</script>

<template>
  <AltocCustomersPage
    resource="customer"
    title="客户列表"
  />
</template>
