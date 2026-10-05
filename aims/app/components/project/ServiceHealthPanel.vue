<script setup lang="ts">
interface HealthMetric {
  key: string
  label: string
  value: number
  available: boolean
  status: 'healthy' | 'warning' | 'critical' | 'unavailable'
}

interface HealthTrend {
  period_end?: string
  total_work_items?: number
  carryover_count?: number
}

const props = defineProps<{ projectId: number }>()
const metrics = ref<HealthMetric[]>([])
const trends = ref<HealthTrend[]>([])
const loading = ref(false)

const statusColor = {
  healthy: 'success',
  warning: 'warning',
  critical: 'error',
  unavailable: 'neutral'
} as const

const maxTrendItems = computed(() => Math.max(1, ...trends.value.map(item => Number(item.total_work_items) || 0)))

onMounted(async () => {
  loading.value = true
  try {
    const response = await $fetch<{ code: number, data: { metrics: HealthMetric[], trends: HealthTrend[] } }>(
      `/api/v1/projects/${props.projectId}/service-health`
    )
    if (response.code === 0) {
      metrics.value = response.data.metrics || []
      trends.value = response.data.trends || []
    }
  } finally {
    loading.value = false
  }
})

function formatMetric(metric: HealthMetric) {
  if (!metric.available) return '-'
  if (metric.key === 'backlog_flow') return metric.value.toFixed(2)
  return `${Math.round(metric.value * 100)}%`
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-heart-pulse" class="size-4 text-primary" />
        <span class="font-semibold">服务健康度</span>
        <span class="text-xs text-muted">近 90 天</span>
      </div>
    </template>
    <div v-if="loading" class="flex justify-center py-6">
      <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
    </div>
    <div v-else class="space-y-4">
      <div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div v-for="metric in metrics" :key="metric.key" class="rounded-lg border border-default p-3">
          <div class="flex items-center justify-between gap-2">
            <p class="text-xs text-muted">
              {{ metric.label }}
            </p>
            <UBadge :color="statusColor[metric.status]" variant="subtle" size="xs">
              {{ metric.status === 'healthy' ? '健康' : metric.status === 'warning' ? '关注' : metric.status === 'critical' ? '异常' : '待接入' }}
            </UBadge>
          </div>
          <p class="mt-2 text-2xl font-semibold">
            {{ formatMetric(metric) }}
          </p>
        </div>
      </div>

      <div v-if="trends.length" class="rounded-lg bg-elevated/40 p-3">
        <div class="mb-3 flex items-center justify-between">
          <p class="text-sm font-medium">
            服务链关期趋势
          </p>
          <span class="text-xs text-muted">工作项 / 结转</span>
        </div>
        <div class="flex h-28 items-end gap-2 overflow-x-auto">
          <div v-for="point in trends" :key="point.period_end" class="flex min-w-14 flex-1 flex-col items-center gap-1">
            <div class="flex h-20 items-end gap-1">
              <div class="w-3 rounded-t bg-primary" :style="{ height: `${Math.max(4, (Number(point.total_work_items) || 0) / maxTrendItems * 80)}px` }" />
              <div class="w-3 rounded-t bg-warning" :style="{ height: `${Math.max(2, (Number(point.carryover_count) || 0) / maxTrendItems * 80)}px` }" />
            </div>
            <span class="text-[10px] text-muted">{{ point.period_end?.slice(0, 7) }}</span>
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>
