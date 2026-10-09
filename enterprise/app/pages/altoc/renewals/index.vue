<script setup lang="ts">
import AltocRenewalsPage from '../../../components/AltocRenewalsPage.vue'

definePageMeta({ name: 'altoc-host-renewals-list', layout: 'enterprise', navigationOwner: 'altoc', logicalModule: 'altoc' })
</script>

<template>
  <AltocRenewalsPage mode="list" />
</template>
