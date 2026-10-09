<script setup lang="ts">
import AltocServiceAgreementsPage from '../../../components/AltocServiceAgreementsPage.vue'

definePageMeta({ name: 'altoc-host-service-agreements-new', layout: 'enterprise', navigationOwner: 'altoc', logicalModule: 'altoc' })
</script>

<template>
  <AltocServiceAgreementsPage mode="new" />
</template>
