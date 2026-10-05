<script setup lang="ts">
import type { Priority } from '~/types/aims'
import { priorityConfig } from '~/config/work-item'

const props = defineProps<{
  priority: string
}>()

const cfg = computed(() => priorityConfig[props.priority as Priority] || { label: props.priority, color: 'neutral', icon: 'i-lucide-minus' })
</script>

<template>
  <UBadge
    :color="(cfg.color as any)"
    variant="subtle"
    size="sm"
  >
    <UIcon :name="cfg.icon" class="size-3" />
    {{ cfg.label }}
  </UBadge>
</template>
