<script setup lang="ts">
import { VisXYContainer, VisLine, VisAxis, VisArea, VisCrosshair, VisTooltip } from '@unovis/vue'
import type { TrendRow } from '~/types/repoinsight'

interface ChartDataPoint {
  month: string
  workload: number
  netLines: number
}

const props = defineProps<{
  year: number | null
  stats: TrendRow[]
}>()

const cardRef = useTemplateRef<HTMLElement | null>('cardRef')
const { width } = useElementSize(cardRef)
const isYearly = computed(() => props.year === null || props.year === 0)

const chartData = computed<ChartDataPoint[]>(() => {
  if (!props.stats || props.stats.length === 0) return []

  return props.stats.map((item) => {
    const label = item.stat_month === 0
      ? `${item.stat_year}`
      : `${item.stat_year}-${String(item.stat_month).padStart(2, '0')}`

    return {
      month: label,
      workload: Number(item.workload) || 0,
      netLines: Number(item.net_lines) || 0
    }
  })
})

const x = (_: ChartDataPoint, i: number) => i
const yWorkload = (d: ChartDataPoint) => d.workload
const yNetLines = (d: ChartDataPoint) => d.netLines

const xTicks = (i: number) => {
  if (!chartData.value[i]) return ''

  if (isYearly.value) {
    return chartData.value[i].month
  }

  if (i === 0 || i === chartData.value.length - 1) return chartData.value[i].month
  const month = chartData.value[i].month?.split('-')[1]
  return month && Number.parseInt(month) % 2 === 1 ? chartData.value[i].month : ''
}

const yTicks = (v: number) => {
  if (v === null || v === undefined || !isFinite(v)) return '0'
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`
  return Math.round(v).toLocaleString('zh-CN')
}

const template = (d: ChartDataPoint) => {
  return `
    <div class="space-y-1">
      <div class="font-semibold">${d.month}</div>
      <div class="text-sm text-primary">加权行数: ${d.workload.toLocaleString('zh-CN')}</div>
      <div class="text-sm text-secondary">净增行数: ${d.netLines.toLocaleString('zh-CN')}</div>
    </div>
  `
}
</script>

<template>
  <UCard
    ref="cardRef"
    :ui="{ root: 'overflow-visible', body: 'sm:p-0', header: 'p-2' }"
  >
    <template #header>
      <div class="flex items-center justify-between">
        <div class="flex items-baseline gap-2">
          <span class="text-md text-highlighted font-semibold pr-2">
            {{ year ? '月度代码行数趋势' : '代码行数趋势' }}
          </span>
          <UBadge
            v-if="year"
            color="primary"
            variant="subtle"
          >
            {{ year }} 年
          </UBadge>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-3 text-xs text-muted">
            <div class="flex items-center gap-2">
              <span
                class="w-3 h-3 rounded-full"
                style="background:var(--ui-primary)"
              />
              <span>加权行数</span>
            </div>
            <div class="flex items-center gap-2">
              <span
                class="w-3 h-3 rounded-full"
                style="background:var(--ui-secondary)"
              />
              <span>净增行数</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div
      v-if="chartData.length > 0"
      class="relative h-88"
    >
      <VisXYContainer
        :data="chartData"
        :margin="{ top: 20, left: 20, right: 20, bottom: 20 }"
        :width="width"
        :height="360"
        :x-domain="[0, chartData.length - 1]"
      >
        <VisArea
          :x="x"
          :y="yNetLines"
          color="var(--ui-secondary)"
          :opacity="0.08"
        />
        <VisLine
          :x="x"
          :y="yWorkload"
          color="var(--ui-primary)"
          :line-width="2.5"
        />
        <VisLine
          :x="x"
          :y="yNetLines"
          color="var(--ui-secondary)"
          :line-width="2"
        />

        <VisAxis
          type="x"
          :x="x"
          :tick-format="xTicks"
        />

        <VisAxis
          type="y"
          :tick-format="yTicks"
          :grid-line="true"
        />

        <VisCrosshair
          color="var(--ui-primary)"
          :template="template"
        />

        <VisTooltip />
      </VisXYContainer>
    </div>

    <div
      v-else
      class="h-88 flex items-center justify-center text-muted"
    >
      暂无数据
    </div>
  </UCard>
</template>

<style scoped>
.unovis-xy-container {
  --vis-crosshair-line-stroke-color: var(--ui-primary);
  --vis-crosshair-circle-stroke-color: var(--ui-bg);

  --vis-axis-grid-color: var(--ui-border);
  --vis-axis-tick-color: var(--ui-border);
  --vis-axis-tick-label-color: var(--ui-text-dimmed);

  --vis-tooltip-background-color: var(--ui-bg);
  --vis-tooltip-border-color: var(--ui-border);
  --vis-tooltip-text-color: var(--ui-text-highlighted);
  --vis-axis-label-color: var(--ui-text-dimmed);
}

.chart-axis-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 368px;
  overflow: hidden;
  pointer-events: none;
}
</style>
