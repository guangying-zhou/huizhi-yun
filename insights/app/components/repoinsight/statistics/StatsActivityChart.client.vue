<script setup lang="ts">
import { VisXYContainer, VisLine, VisAxis, VisCrosshair, VisTooltip } from '@unovis/vue'
import type { TrendRow } from '~/types/repoinsight'

interface ChartDataPoint {
  month: string
  repos: number
  contributors: number
}

const props = defineProps<{
  year: number | null
  stats: TrendRow[]
}>()

const cardRef = useTemplateRef<HTMLElement | null>('cardRef')
const { width } = useElementSize(cardRef)

const pending = ref(false)

const isYearly = computed(() => props.year === null || props.year === 0)

const chartData = computed<ChartDataPoint[]>(() => {
  if (!props.stats || props.stats.length === 0) return []

  return props.stats.map((item) => {
    const label = item.stat_month === 0
      ? `${item.stat_year}`
      : `${item.stat_year}-${String(item.stat_month).padStart(2, '0')}`

    return {
      month: label,
      repos: Number(item.active_repos) || 0,
      contributors: Number(item.active_contributors) || 0
    }
  })
})

const x = (_: ChartDataPoint, i: number) => i
const yRepos = (d: ChartDataPoint) => d.repos
const yContributors = (d: ChartDataPoint) => d.contributors

const xTicks = (i: number) => {
  if (!chartData.value[i]) return ''

  if (isYearly.value) {
    return chartData.value[i].month
  }

  if (i === 0 || i === chartData.value.length - 1) return chartData.value[i].month
  const month = chartData.value[i].month?.split('-')[1]
  return month && Number.parseInt(month) % 2 === 1 ? chartData.value[i].month : ''
}

const yReposTicks = (v: number) => Math.round(v).toLocaleString('zh-CN')
const yContributorsTicks = (v: number) => Math.round(v).toLocaleString('zh-CN')
const yLeftLabel = computed(() => '活跃仓库数')
const yRightLabel = computed(() => '参与人数')

const template = (d: ChartDataPoint) => {
  return `
    <div class="space-y-1">
      <div class="font-semibold">${d.month}</div>
      <div class="text-sm text-primary">活跃仓库: ${d.repos.toLocaleString('zh-CN')}</div>
      <div class="text-sm text-secondary">参与人数: ${d.contributors.toLocaleString('zh-CN')}</div>
    </div>
  `
}
</script>

<template>
  <UCard
    ref="cardRef"
    :ui="{ root: 'overflow-visible !p-0', body: 'sm:p-0 m-0', header: 'p-2' }"
  >
    <template #header>
      <div class="flex items-center justify-between">
        <div v-if="!pending">
          <span class="text-md text-highlighted font-semibold pr-2">
            {{ year ? '月度活跃度趋势' : '活跃度趋势' }}
          </span>
          <UBadge
            v-if="year"
            color="primary"
            variant="subtle"
          >
            {{ year }} 年
          </UBadge>
          <!-- <USkeleton v-else class="h-9 w-32" /> -->
        </div>
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-3 text-xs text-muted">
            <div class="flex items-center gap-2">
              <span
                class="w-3 h-3 rounded-full"
                style="background:var(--ui-primary)"
              />
              <span>活跃仓库</span>
            </div>
            <div class="flex items-center gap-2">
              <span
                class="w-3 h-3 rounded-full"
                style="background:var(--ui-secondary)"
              />
              <span>参与人数</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div
      v-if="pending"
      class="h-88 flex items-center justify-center"
    >
      <USkeleton class="h-full w-full" />
    </div>

    <div
      v-else-if="chartData.length > 0"
      class="h-88 relative"
    >
      <!-- First container: Left Y-axis (repos) with line -->
      <VisXYContainer
        :data="chartData"
        :margin="{ top: 20, left: 10, right: 80, bottom: 20 }"
        :width="width"
        :height="368"
        :x-domain="[0, chartData.length - 1]"
      >
        <VisLine
          :x="x"
          :y="yRepos"
          color="var(--ui-primary)"
          :line-width="2.5"
        />
        <VisLine
          :x="x"
          :y="yContributors"
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
          :y="yRepos"
          :tick-format="yReposTicks"
          :label="yLeftLabel"
          tick-text-color="var(--ui-primary)"
          label-color="var(--ui-primary)"
        />

        <VisCrosshair
          color="var(--ui-primary)"
          :template="template"
        />

        <VisTooltip />
      </VisXYContainer>

      <!-- Second container: Right Y-axis (contributors) overlaid -->
      <div
        style="position: absolute; top: 0; left: 0; width: 100%; height: 368px; overflow: hidden; pointer-events: none;"
      >
        <VisXYContainer
          :data="chartData"
          :margin="{ top: 20, left: 10, right: 80, bottom: 20 }"
          :auto-margin="false"
          :width="width"
          :height="368"
          :x-domain="[0, chartData.length - 1]"
        >
          <VisAxis
            type="y"
            position="right"
            :y="yContributors"
            :tick-format="yContributorsTicks"
            :label="yRightLabel"
            :grid-line="false"
            :label-margin="10"
            tick-text-color="var(--ui-info)"
            label-color="var(--ui-info)"
          />
        </VisXYContainer>
      </div>
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
  --vis-crosshair-line-stroke-color: var(--ui-warning);
  --vis-crosshair-circle-stroke-color: var(--ui-bg);

  --vis-axis-grid-color: var(--ui-border);
  --vis-axis-tick-color: var(--ui-border);
  --vis-axis-tick-label-color: var(--ui-text-dimmed);

  --vis-tooltip-background-color: var(--ui-bg);
  --vis-tooltip-border-color: var(--ui-border);
  --vis-tooltip-text-color: var(--ui-text-highlighted);
  --vis-axis-label-color: var(--ui-text-dimmed);
}
</style>
