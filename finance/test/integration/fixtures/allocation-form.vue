<script setup lang="ts">
import FinanceEntityFormSlideover from '../../../app/components/FinanceEntityFormSlideover.vue'
import { pageConfigs } from '../../../app/config/pageConfigs'
const config = pageConfigs['project-accounting/allocations']!
const open = ref(false)
const form = ref<Record<string, string>>({})
const error = ref('')
const saved = ref('')
function submit() {
  // Preview transport stub; the production runtime validates currency separately.
  if (form.value.currencyCode && !/^[A-Z]{3}$/.test(form.value.currencyCode)) {
    error.value = '币种必须为三位大写代码'
    return
  }
  saved.value = JSON.stringify(form.value)
  error.value = ''
  open.value = false
}
</script>
<template>
  <main class="p-6">
    <UButton @click="open = true">新建分摊</UButton>
    <pre data-testid="saved">{{ saved }}</pre>
    <FinanceEntityFormSlideover v-model:open="open" v-model:form="form"
      :title="config.title" :description="config.description" :fields="config.createFields!"
      :error="error" :get-field-options="() => []" :get-selected-file-name="() => ''"
      @submit="submit" @cancel="open = false" />
  </main>
</template>
