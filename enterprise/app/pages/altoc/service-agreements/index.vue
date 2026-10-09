<script setup lang="ts">
import AltocServiceAgreementsPage from '../../../components/AltocServiceAgreementsPage.vue'

definePageMeta({ name: 'altoc-host-service-agreements-list', layout: 'enterprise', navigationOwner: 'altoc', logicalModule: 'altoc' })
</script>

<template>
  <AltocServiceAgreementsPage mode="list" />
</template>
