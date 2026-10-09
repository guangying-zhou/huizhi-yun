<script setup lang="ts">
const props = withDefaults(defineProps<{
  text?: string | number | null
  max?: number
}>(), {
  max: 16
})

const fullText = computed(() => String(props.text ?? ''))
const chars = computed(() => Array.from(fullText.value))
const isTruncated = computed(() => chars.value.length > props.max)
const displayText = computed(() => isTruncated.value ? `${chars.value.slice(0, props.max).join('')}...` : fullText.value)
</script>

<template>
  <span
    class="inline-block max-w-full align-bottom"
    :title="isTruncated ? fullText : undefined"
  >
    {{ displayText || '-' }}
  </span>
</template>
