<script setup lang="ts">
import UserTreeSelector from '../../../foundation/app/components/UserTreeSelector.vue'

const props = defineProps<{ disabled?: boolean }>()
const model = defineModel<string>({ required: true })
const selected = computed({ get: () => model.value ? [model.value] : [], set: (uids: string[]) => {
  model.value = uids[0] || ''
} })
</script>

<template>
  <UserTreeSelector
    v-model="selected"
    selection-mode="single"
    hide-committees
    width-class="w-full"
    :disabled="props.disabled"
  />
</template>
