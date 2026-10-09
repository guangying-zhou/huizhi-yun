<script setup lang="ts">
import W3MigrationQueuePage from '../../app/components/host/W3MigrationQueuePage.vue'

defineOptions({ name: 'FinanceMigrationPage' })
definePageMeta({ hostContentInset: false })
</script>

<template>
  <W3MigrationQueuePage app="finance" />
</template>
