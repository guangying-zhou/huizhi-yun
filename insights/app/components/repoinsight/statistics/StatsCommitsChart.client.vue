<script setup lang="ts">
import { VisXYContainer, VisLine, VisAxis, VisArea, VisCrosshair, VisTooltip } from '@unovis/vue'
import type { TrendRow } from '~/types/repoinsight'

interface ChartDataPoint {
  month: string
  commits: number
  linesAdded: number
  linesDeleted: number
  linesModified: number
  submissionQuality: number // 提交质量
}

const props = defineProps<{
  year: number | null
  stats: TrendRow[]
}>()

const cardRef = useTemplateRef<HTMLElement | null>('cardRef')
const { width } = useElementSize(cardRef)

// 根据 year 是否为 null 决定是月度还是年度数据
const isYearly = computed(() => props.year === null || props.year === 0)

const chartData = computed<ChartDataPoint[]>(() => {
  if (!props.stats || props.stats.length === 0) return []

  return props.stats.map((item) => {
    const added = Number(item.lines_added) || 0
    const deleted = Number(item.lines_deleted) || 0
    const modified = Number(item.lines_modified) || 0

    // 如果是年度数据（stat_month === 0），只显示年份
    const label = item.stat_month === 0
      ? `${item.stat_year}`
      : `${item.stat_year}-${String(item.stat_month).padStart(2, '0')}`

    return {
      month: label,
      commits: Number(item.total_commits) || 0,
      linesAdded: added,
      linesDeleted: deleted,
      linesModified: modified,
      submissionQuality: Number(item.submission_quality) || 0
    }
  })
})

const x = (_: ChartDataPoint, i: number) => i
const yCommits = (d: ChartDataPoint) => d.commits
// 提交质量是百分比(0-100)，需要缩放到与提交次数同量级
const qualityScale = computed(() => {
  if (!chartData.value.length) return 1
  const maxCommits = Math.max(...chartData.value.map(d => d.commits), 1)
  // 将100%缩放到与最大提交次数同量级
  return maxCommits / 100
})
const yQuality = (d: ChartDataPoint) => d.submissionQuality * qualityScale.value

// const totalCommits = computed(() =>
//   chartData.value.reduce((sum, item) => sum + item.commits, 0)
// )

const hasData = computed(() => chartData.value.length > 0)

const _xTicks = (i: number) => {
  if (!chartData.value[i]) return ''

  // 年度数据：显示所有年份
  if (isYearly.value) {
    return chartData.value[i].month
  }

  // 月度数据：显示首尾 + 奇数月份
  if (i === 0 || i === chartData.value.length - 1) return chartData.value[i].month
  const month = chartData.value[i].month?.split('-')[1]
  return month && Number.parseInt(month) % 2 === 1 ? chartData.value[i].month : ''
}

// 左侧提交次数 y 轴刻度
const yCommitTicks = (v: number) => {
  if (v === null || v === undefined || !isFinite(v)) return '0'
  return Math.round(v).toLocaleString('zh-CN')
}
// 右侧提交质量刻度格式
const _yQualityTicks = (v: number) => `${Math.round(v / qualityScale.value)}%`
const yLeftLabel = computed(() => '提交次数')
const yRightLabel = computed(() => '提交质量')

const template = (d: ChartDataPoint) => {
  return `
    <div class="space-y-1">
      <div class="font-semibold">${d.month}</div>
      <div class="text-sm text-primary">提交: ${d.commits.toLocaleString('zh-CN')} 次</div>
      <div class="text-sm text-secondary">质量: ${d.submissionQuality.toFixed(1)}%</div>
      <div><hr/></div>
      <div class="text-sm text-success">增加: ${d.linesAdded.toLocaleString('zh-CN')} 行</div>
      <div class="text-sm text-error">删除: ${d.linesDeleted.toLocaleString('zh-CN')} 行</div>
      <div class="text-sm text-warning">修改: ${d.linesModified.toLocaleString('zh-CN')} 行</div>
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
        <div>
          <span class="text-md text-highlighted font-semibold pr-2">
            {{ year ? '月度提交趋势' : '提交趋势' }}
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
          <!-- Legend: clear labels for commits vs change lines -->
          <div class="flex items-center gap-3 text-xs text-muted">
            <div class="flex items-center gap-2">
              <span
                class="w-3 h-3 rounded-full"
                style="background:var(--ui-primary)"
              />
              <span>提交次数</span>
            </div>
            <div class="flex items-center gap-2">
              <span
                class="w-3 h-3 rounded-full"
                style="background:var(--ui-secondary)"
              />
              <span>提交质量</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div class="relative h-88">
      <template v-if="hasData">
        <!-- First container: Left Y-axis (commits) with area and line -->
        <VisXYContainer
          :data="chartData"
          :margin="{ top: 20, left: 10, right: 110, bottom: 20 }"
          :width="width"
          :height="368"
          :x-domain="[0, chartData.length - 1]"
        >
          <VisArea
            :x="x"
            :y="yQuality"
            color="var(--ui-secondary)"
            :opacity="0.08"
          />
          <VisLine
            :x="x"
            :y="yCommits"
            color="var(--ui-primary)"
            :line-width="2.5"
          />
          <VisLine
            :x="x"
            :y="yQuality"
            color="var(--ui-secondary)"
            :line-width="2"
          />

          <VisAxis
            type="x"
            :x="x"
            :tick-format="_xTicks"
          />

          <VisAxis
            type="y"
            :y="yCommits"
            :tick-format="yCommitTicks"
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

        <!-- Second container: Right Y-axis (quality) overlaid -->
        <div class="chart-axis-overlay">
          <VisXYContainer
            :data="chartData"
            :margin="{ top: 20, left: 10, right: 110, bottom: 20 }"
            :auto-margin="false"
            :width="width"
            :height="368"
            :x-domain="[0, chartData.length - 1]"
          >
            <VisAxis
              type="y"
              position="right"
              :y="yQuality"
              :tick-format="_yQualityTicks"
              :label="yRightLabel"
              :grid-line="false"
              :label-margin="10"
              tick-text-color="var(--ui-secondary)"
              label-color="var(--ui-secondary)"
            />
          </VisXYContainer>
        </div>
      </template>

      <div
        v-else
        class="empty-state text-muted"
      >
        暂无数据
      </div>
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
  /* make axis labels readable by default inside this container */
  --vis-axis-tick-label-color: var(--ui-text-dimmed);
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

.empty-state,
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-state {
  background-color: var(--ui-bg);
  opacity: 0.7;
}

.loading-overlay {
  background-color: var(--ui-bg);
  opacity: 0.85;
  backdrop-filter: blur(2px);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
