<script setup lang="ts">
const props = defineProps<{
  checked: boolean
  indeterminate: boolean
}>()

const emit = defineEmits<{
  change: []
}>()

const inputRef = ref<HTMLInputElement | null>(null)

// Force DOM sync for both checked and indeterminate on every state change
watchEffect(() => {
  const el = inputRef.value
  if (!el) return
  // Touch props to register reactive deps
  const c = props.checked
  const i = props.indeterminate
  el.checked = c
  el.indeterminate = i
})

function onClick(e: MouseEvent) {
  e.stopPropagation()
  // Prevent native toggle; we control state via our emit
  e.preventDefault()
  emit('change')
}
</script>

<template>
  <input
    ref="inputRef"
    type="checkbox"
    class="shrink-0"
    @click="onClick"
  >
</template>
