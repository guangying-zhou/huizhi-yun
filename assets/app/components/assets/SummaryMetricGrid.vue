<script setup lang="ts">
import type { SummaryMetric } from '~/types'

defineProps<{
  metrics: SummaryMetric[]
}>()

const getBadgeColor = (color?: SummaryMetric['color']) => color || 'neutral'
</script>

<template>
  <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
    <UCard
      v-for="metric in metrics"
      :key="metric.label"
      variant="subtle"
      :ui="{ body: 'space-y-1' }"
    >
      <p class="text-sm text-muted">
        {{ metric.label }}
      </p>
      <p class="text-2xl font-semibold">
        {{ metric.value }}
      </p>
      <UBadge :color="getBadgeColor(metric.color)" variant="soft">
        {{ metric.hint || '实时指标' }}
      </UBadge>
    </UCard>
  </div>
</template>
