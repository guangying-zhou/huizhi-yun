<script setup lang="ts">
import type { SummaryMetric } from '../../types'

defineProps<{
  metrics: SummaryMetric[]
}>()

const getBadgeColor = (color?: SummaryMetric['color']) => color || 'neutral'
</script>

<template>
  <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <UCard
      v-for="metric in metrics"
      :key="metric.label"
      variant="subtle"
      :ui="{ body: 'space-y-1 p-3 sm:p-4' }"
    >
      <p class="text-xs text-toned sm:text-sm">
        {{ metric.label }}
      </p>
      <p class="text-2xl font-semibold tabular-nums">
        {{ metric.value }}
      </p>
      <UBadge :color="getBadgeColor(metric.color)" variant="soft">
        {{ metric.hint || '实时指标' }}
      </UBadge>
    </UCard>
  </div>
</template>
