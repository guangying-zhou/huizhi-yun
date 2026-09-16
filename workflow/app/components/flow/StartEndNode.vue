<template>
  <Handle v-if="data.type === 'end'" type="target" :position="Position.Left" />
  <div
    class="px-5 py-2 rounded-full text-sm font-semibold border-2 whitespace-nowrap"
    :class="data.type === 'start'
      ? 'bg-success-50 text-success-700 border-success-200'
      : 'bg-warning-50 text-warning-700 border-warning-200'"
  >
    {{ data.label }}
  </div>
  <Handle v-if="data.type === 'start'" type="source" :position="Position.Right" />
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

defineProps<{
  data: {
    type: 'start' | 'end'
    label: string
  }
}>()
</script>
