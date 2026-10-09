<script setup lang="ts">
import AltocCustomersPage from '../../../components/AltocCustomersPage.vue'

definePageMeta({ name: 'altoc-host-customers-detail', navigationOwner: 'altoc', logicalModule: 'altoc', layout: 'enterprise', hostContentInset: false })
</script>

<template>
  <AltocCustomersPage detail />
</template>
