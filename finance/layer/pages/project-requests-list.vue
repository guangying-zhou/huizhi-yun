<script setup lang="ts">
import FinanceLedgerList from '../../app/components/host/FinanceLedgerList.vue'

definePageMeta({ hostContentInset: false })
</script>

<template>
  <FinanceLedgerList kind="project-requests" />
</template>
