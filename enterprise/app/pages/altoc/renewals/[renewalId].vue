<script setup lang="ts">
import AltocRenewalsPage from '../../../components/AltocRenewalsPage.vue'

definePageMeta({ name: 'altoc-host-renewals-detail', layout: 'enterprise', navigationOwner: 'altoc', logicalModule: 'altoc' })
</script>

<template>
  <AltocRenewalsPage mode="detail" />
</template>
