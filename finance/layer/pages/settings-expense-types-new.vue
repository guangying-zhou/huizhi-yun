<script setup lang="ts">
import FinanceSettingsPage from '../../app/components/host/FinanceSettingsPage.vue'

definePageMeta({ hostContentInset: false })
</script>

<template>
  <FinanceSettingsPage
    kind="expense-types"
    form-mode
  />
</template>
