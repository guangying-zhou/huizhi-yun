<script setup lang="ts">
import AltocReceivablesPage from '../../../components/AltocReceivablesPage.vue'

definePageMeta({ name: 'altoc-host-payments-detail', navigationOwner: 'altoc', logicalModule: 'altoc', layout: 'enterprise' })
</script>

<template>
  <AltocReceivablesPage detail />
</template>
