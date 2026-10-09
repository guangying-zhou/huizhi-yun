<script setup lang="ts">
import AltocServiceTicketsPage from '../../../components/AltocServiceTicketsPage.vue'

definePageMeta({ name: 'altoc-host-service-tickets-index', layout: 'enterprise', navigationOwner: 'altoc', logicalModule: 'altoc' })
</script>

<template>
  <AltocServiceTicketsPage mode="list" />
</template>
