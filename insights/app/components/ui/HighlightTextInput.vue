<script setup lang="ts">
import { TextHighlightProcessor } from '~/utils/textHighlight'

interface Props {
  modelValue: string
  placeholder?: string
  label?: string
  help?: string
  disabled?: boolean
  rows?: number
}

interface Emits {
  (e: 'update:modelValue', value: string): void
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Enter text, use **words** to highlight',
  rows: 3
})

const emit = defineEmits<Emits>()

// Convert technical syntax to user syntax for editing
const displayValue = computed(() => {
  return TextHighlightProcessor.processForEditor(props.modelValue)
})

// Handle input changes
const handleInput = (value: string) => {
  // Validate syntax
  const validation = TextHighlightProcessor.validateSyntax(value)

  if (validation.valid) {
    // Convert to technical syntax and emit
    const technicalValue = TextHighlightProcessor.processForSaving(value)
    emit('update:modelValue', technicalValue)
  } else {
    // If syntax error, pass original value
    emit('update:modelValue', value)
  }
}

// Real-time preview HTML
const previewHtml = computed(() => {
  return TextHighlightProcessor.processForPreview(displayValue.value)
})

// Syntax validation
const validation = computed(() => {
  return TextHighlightProcessor.validateSyntax(displayValue.value)
})

// Input reference for validation errors
const inputRef = ref<HTMLInputElement>()
</script>

<template>
  <div class="space-y-2">
    <!-- Label -->
    <label
      v-if="label"
      class="block text-sm font-medium text-gray-700 dark:text-gray-300"
    >
      {{ label }}
    </label>

    <!-- Text input -->
    <UInput
      ref="inputRef"
      :model-value="displayValue"
      :placeholder="placeholder"
      :disabled="disabled"
      @update:model-value="handleInput"
      class="font-mono w-full"
      size="sm"
    />

    <!-- Help text below input -->
    <p v-if="help" class="text-xs text-gray-500 dark:text-gray-400">{{ help }}</p>

    <!-- Validation errors -->
    <div v-if="!validation.valid" class="space-y-1">
      <div
        v-for="error in validation.errors"
        :key="error"
        class="text-sm text-red-600 dark:text-red-400"
      >
        {{ error }}
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Ensure monospace font displays in input box */
.font-mono {
  font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
}
</style>
