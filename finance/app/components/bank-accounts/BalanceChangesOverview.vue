<script setup lang="ts">
import type { BalanceChangeRow, BalanceChangeSummary } from '~/utils/bankAccountCharts'
import {
  buildWaterfallChart,
  formatAxisMoney,
  formatPlainMoney,
  formatSignedMoney
} from '~/utils/bankAccountCharts'

const props = defineProps<{
  rows: BalanceChangeRow[]
  summary: BalanceChangeSummary
  loading?: boolean
}>()

const emit = defineEmits<{
  refresh: []
}>()

const chartContainer = shallowRef<HTMLElement | null>(null)
const chartWidth = ref(1200)
const tooltip = ref({
  open: false,
  x: 0,
  y: 0,
  date: '',
  change: '',
  total: ''
})
let resizeObserver: ResizeObserver | null = null

const chart = computed(() => buildWaterfallChart(props.rows, chartWidth.value))

function updateChartWidth() {
  const width = chartContainer.value?.clientWidth || 0
  if (width > 0) chartWidth.value = Math.max(760, Math.round(width))
}

function connectResizeObserver() {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (!chartContainer.value) return

  updateChartWidth()
  if (typeof ResizeObserver === 'undefined') return

  resizeObserver = new ResizeObserver(updateChartWidth)
  resizeObserver.observe(chartContainer.value)
}

function moveTooltip(event: MouseEvent) {
  const rect = chartContainer.value?.getBoundingClientRect()
  if (!rect) return
  const x = event.clientX - rect.left + 12
  const y = event.clientY - rect.top + 12
  tooltip.value = {
    ...tooltip.value,
    x: Math.min(Math.max(x, 8), rect.width - 168),
    y: Math.min(Math.max(y, 8), rect.height - 72)
  }
}

function showTooltip(bar: { date: string, change: number, total: number }, event: MouseEvent) {
  tooltip.value = {
    ...tooltip.value,
    open: true,
    date: bar.date,
    change: formatSignedMoney(bar.change),
    total: formatPlainMoney(bar.total)
  }
  moveTooltip(event)
}

function hideTooltip() {
  tooltip.value = { ...tooltip.value, open: false }
}

onMounted(connectResizeObserver)
onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <div class="mb-4 space-y-4">
    <div class="grid gap-3 md:grid-cols-3">
      <div class="rounded-lg border border-default p-3">
        <p class="text-xs text-muted">
          期初余额
        </p>
        <p class="mt-1 text-lg font-semibold text-highlighted">
          {{ formatPlainMoney(summary.opening_balance) }}
        </p>
      </div>
      <div class="rounded-lg border border-default p-3">
        <p class="text-xs text-muted">
          期末余额
        </p>
        <p class="mt-1 text-lg font-semibold text-highlighted">
          {{ formatPlainMoney(summary.closing_balance) }}
        </p>
      </div>
      <div class="rounded-lg border border-default p-3">
        <p class="text-xs text-muted">
          净变动
        </p>
        <p class="mt-1 text-lg font-semibold text-highlighted">
          {{ formatSignedMoney(summary.net_change) }}
        </p>
      </div>
    </div>

    <div
      ref="chartContainer"
      class="relative min-w-0 rounded-lg border border-default p-3"
    >
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <p class="font-medium text-highlighted">
            账户总余额阶梯图
          </p>
          <p class="text-sm text-muted">
            {{ rows.length }} 个变动日期
          </p>
        </div>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          :loading="loading"
          title="刷新余额变动"
          aria-label="刷新余额变动"
          @click="emit('refresh')"
        />
      </div>

      <div
        v-if="chart.bars.length"
        class="w-full"
      >
        <svg
          :viewBox="`0 0 ${chart.width} ${chart.height}`"
          class="h-80 w-full"
          role="img"
          aria-label="账户总余额瀑布图"
        >
          <g
            v-for="tick in chart.yTicks"
            :key="tick.amount"
          >
            <line
              :x1="chart.axisLeft"
              :y1="tick.y"
              :x2="chart.axisRight"
              :y2="tick.y"
              style="stroke: var(--ui-border);"
              stroke-width="1"
              stroke-dasharray="3 6"
            />
            <text
              :x="chart.axisLeft - 10"
              :y="tick.y + 4"
              text-anchor="end"
              class="text-[10px]"
              style="fill: var(--ui-text-muted);"
            >
              {{ formatAxisMoney(tick.amount) }}
            </text>
          </g>
          <line
            :x1="chart.axisLeft"
            :y1="chart.axisTop"
            :x2="chart.axisLeft"
            :y2="chart.axisBottom"
            style="stroke: var(--ui-text-muted);"
            stroke-width="1.5"
          />
          <line
            :x1="chart.axisLeft"
            :y1="chart.axisBottom"
            :x2="chart.axisRight"
            :y2="chart.axisBottom"
            style="stroke: var(--ui-text-muted);"
            stroke-width="1.5"
          />
          <line
            :x1="chart.axisLeft"
            :y1="chart.zeroY"
            :x2="chart.axisRight"
            :y2="chart.zeroY"
            style="stroke: var(--ui-text-muted);"
            stroke-width="1.25"
          />
          <g
            v-for="(bar, index) in chart.bars"
            :key="`${bar.date}-${index}`"
          >
            <line
              v-if="index < chart.bars.length - 1"
              :x1="bar.connectorX1"
              :y1="bar.connectorY1"
              :x2="bar.connectorX2"
              :y2="bar.connectorY2"
              style="stroke: var(--ui-text-muted);"
              stroke-width="1"
              stroke-dasharray="4 5"
            />
            <rect
              :x="bar.x"
              :y="bar.y"
              :width="bar.width"
              :height="bar.height"
              rx="3"
              class="cursor-pointer"
              :class="{
                'fill-success': bar.direction === 'increase',
                'fill-error': bar.direction === 'decrease',
                'fill-muted': bar.direction === 'flat'
              }"
              @mouseenter="showTooltip(bar, $event)"
              @mousemove="moveTooltip"
              @mouseleave="hideTooltip"
            />
            <text
              v-if="bar.showValueLabel"
              :x="bar.x + bar.width / 2"
              :y="bar.y - 7"
              text-anchor="middle"
              class="text-[10px]"
              style="fill: var(--ui-text-muted);"
            >
              {{ formatSignedMoney(bar.change) }}
            </text>
          </g>
          <g
            v-for="label in chart.labels"
            :key="label.date"
          >
            <line
              :x1="label.x"
              :y1="chart.axisTop"
              :x2="label.x"
              :y2="chart.axisBottom"
              style="stroke: var(--ui-border);"
              stroke-width="1"
              stroke-dasharray="3 6"
            />
            <text
              :x="label.x"
              :y="chart.axisBottom + 20"
              text-anchor="middle"
              class="text-[11px]"
              style="fill: var(--ui-text-muted);"
            >
              {{ label.date }}
            </text>
          </g>
        </svg>
        <div
          v-if="tooltip.open"
          class="pointer-events-none absolute z-10 rounded-md border border-default bg-default px-3 py-2 text-xs shadow-lg"
          :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
        >
          <p class="font-medium text-highlighted">
            {{ tooltip.date }}
          </p>
          <p class="mt-1 text-muted">
            资金变动金额：{{ tooltip.change }}
          </p>
          <p class="mt-1 text-muted">
            变动后余额：{{ tooltip.total }}
          </p>
        </div>
      </div>
      <UAlert
        v-else
        icon="i-lucide-chart-no-axes-combined"
        color="neutral"
        variant="subtle"
        title="当前区间暂无余额变动"
      />
    </div>
  </div>
</template>
