<script setup lang="ts">
import { statusConfig } from '~/config/work-item'

const props = defineProps<{
  status: string
}>()

const cfg = computed(() => statusConfig[props.status] || { label: props.status, color: 'neutral' })
</script>

<template>
  <UBadge
    :color="(cfg.color as any)"
    variant="subtle"
    size="sm"
  >
    {{ cfg.label }}
  </UBadge>
</template>
