<script setup lang="ts">
import FinanceCostList from '../../app/components/host/FinanceCostList.vue'

definePageMeta({ hostContentInset: false })
</script>

<template>
  <FinanceCostList kind="project-cost-allocations" />
</template>
