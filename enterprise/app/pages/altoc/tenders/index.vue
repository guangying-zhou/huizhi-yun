<script setup lang="ts">
import AltocTendersPage from '../../../components/AltocTendersPage.vue'

definePageMeta({ name: 'altoc-host-tenders-list', layout: 'enterprise', navigationOwner: 'altoc', logicalModule: 'altoc' })
</script>

<template>
  <AltocTendersPage mode="list" />
</template>
