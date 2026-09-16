<script setup lang="ts">
import type { WorkItemType } from '~/types/aims'
import { typeConfig } from '~/config/work-item'

const props = defineProps<{
  type: string
}>()

const cfg = computed(() => typeConfig[props.type as WorkItemType] || { label: props.type, icon: 'i-lucide-circle', color: 'text-neutral' })
</script>

<template>
  <span class="inline-flex items-center gap-1">
    <UIcon :name="cfg.icon" :class="['size-4', cfg.color]" />
    <span class="text-sm">{{ cfg.label }}</span>
  </span>
</template>
