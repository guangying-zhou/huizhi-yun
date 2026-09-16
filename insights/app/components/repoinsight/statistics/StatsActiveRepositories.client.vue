<script setup lang="ts">
import { VisXYContainer, VisGroupedBar, VisAxis, VisTooltip, VisCrosshair } from '@unovis/vue'

const router = useRouter()
const { apiBase } = useApiBase()

interface ActiveRepoStats {
  repo_catalog_id: number
  repo_name: string
  active_contributors: number
  total_commits: number
  total_lines_changed: number
  files_added: number
  survival_days: number
}

interface ChartDataPoint {
  name: string
  contributors: number
  commits: number
  lines: number
  files: number
  survival_days: number
}

const props = defineProps<{
  year: number | null
  limit?: number
}>()

const cardRef = useTemplateRef<HTMLElement | null>('cardRef')
const { width } = useElementSize(cardRef)

const repoStats = ref<ActiveRepoStats[]>([])
const pending = ref(false)

// 是否显示存续天数 - 仅在全部年度时显示
const showSurvivalDays = computed(() => !props.year || props.year === 0)

// 智能缩放系数 - 确保代码行数显示数值最大，同时保持柱子高度合理
const scaleFactors = computed(() => {
  if (!chartData.value || chartData.value.length === 0) {
    return { lines: 1000, files: 10, commits: 1, survival: 1 }
  }

  const maxLines = Math.max(...chartData.value.map(d => d.lines))
  const maxFiles = Math.max(...chartData.value.map(d => d.files))
  const maxCommits = Math.max(...chartData.value.map(d => d.commits))
  const maxSurvival = Math.max(...chartData.value.map(d => d.survival_days))
  const maxContributors = Math.max(...chartData.value.map(d => d.contributors))

  // 目标：将所有数据缩放到 1000-10000 范围内，但代码行数缩放后最大
  const targetRange = 5000

  // 计算每个指标的缩放系数（10的幂次）
  const calcScale = (max: number): number => {
    if (max <= 0) return 1
    // 计算使 max / scale 接近 targetRange 的系数
    const idealScale = max / targetRange
    if (idealScale <= 1) return 1
    // 使用10的幂次
    const power = Math.round(Math.log10(idealScale))
    return Math.pow(10, Math.max(0, power))
  }

  // 计算初始缩放系数
  let linesScale = calcScale(maxLines)
  const filesScale = calcScale(maxFiles)
  const commitsScale = calcScale(maxCommits)
  const survivalScale = calcScale(maxSurvival)

  // 确保代码行数缩放后的值最大
  // 先计算各项缩放后的值
  const scaledLines = maxLines / linesScale
  const scaledFiles = maxFiles / filesScale
  const scaledCommits = maxCommits / commitsScale
  const scaledSurvival = maxSurvival / survivalScale
  const scaledContributors = maxContributors // 参与人数不缩放

  // 如果其他项缩放后的值比代码行数大，增加其缩放系数
  const maxOther = Math.max(scaledFiles, scaledCommits, scaledSurvival, scaledContributors)
  if (maxOther > scaledLines && scaledLines > 0) {
    // 减少代码行数的缩放系数（使其显示值更大）
    while (linesScale > 1 && maxLines / (linesScale / 10) < maxOther * 5) {
      linesScale = linesScale / 10
    }
  }

  return {
    lines: Math.max(1, linesScale),
    files: Math.max(1, filesScale),
    commits: Math.max(1, commitsScale),
    survival: Math.max(1, survivalScale)
  }
})

// 格式化缩放系数显示
const formatScale = (scale: number): string => {
  if (scale === 1) return ''
  if (scale >= 1000000) return ` (÷${(scale / 1000000).toFixed(0)}M)`
  if (scale >= 1000) return ` (÷${(scale / 1000).toFixed(0)}K)`
  return ` (÷${scale})`
}

async function loadRepoStats() {
  pending.value = true
  try {
    console.log('[StatsActiveRepositories] Loading data for year:', props.year)
    repoStats.value = await $fetch<ActiveRepoStats[]>(`${apiBase}/statistics/active-repositories`, {
      query: {
        year: props.year ?? 0,
        limit: props.limit || 5
      }
    })
  } catch (error) {
    console.error('[StatsActiveRepositories] Failed to load data:', error)
    repoStats.value = []
  } finally {
    pending.value = false
  }
}

watch(() => [props.year, props.limit], () => {
  console.log('[StatsActiveRepositories] Props changed, reloading...')
  loadRepoStats()
})

onMounted(() => {
  loadRepoStats()
})

function navigateToReport() {
  router.push({ path: '/reports/repos', state: { year: props.year } })
}

const chartData = computed<ChartDataPoint[]>(() => {
  if (!repoStats.value || repoStats.value.length === 0) return []

  return repoStats.value.map(item => ({
    name: item.repo_name,
    contributors: Number(item.active_contributors) || 0,
    commits: Number(item.total_commits) || 0,
    lines: Number(item.total_lines_changed) || 0,
    files: Number(item.files_added) || 0,
    survival_days: Number(item.survival_days) || 0
  }))
})

const x = (_: ChartDataPoint, i: number) => i
const y = computed(() => {
  const baseY = [
    (d: ChartDataPoint) => d.lines / scaleFactors.value.lines,
    (d: ChartDataPoint) => d.files / scaleFactors.value.files,
    (d: ChartDataPoint) => d.commits / scaleFactors.value.commits
  ]

  if (showSurvivalDays.value) {
    baseY.push((d: ChartDataPoint) => d.survival_days / scaleFactors.value.survival)
  }

  baseY.push((d: ChartDataPoint) => d.contributors)
  return baseY
})

const colors = computed(() => {
  const baseColors = ['var(--ui-primary)', 'var(--ui-secondary)', 'var(--ui-success)']
  if (showSurvivalDays.value) {
    baseColors.push('var(--ui-warning)')
  }
  baseColors.push('var(--ui-error)')
  return baseColors
})

const xTicks = (i: number) => {
  if (!chartData.value[i]) return ''
  const name = chartData.value[i].name
  // 缩短显示名称以避免重叠
  return name.length > 10 ? name.substring(0, 8) + '...' : name
}

const template = (d: ChartDataPoint) => {
  return `
    <div class="space-y-1 min-w-[150px]">
      <div class="font-semibold border-b border-gray-200 dark:border-gray-700 pb-1 mb-1">${d.name}</div>
      <div class="flex items-center justify-between text-sm gap-4">
        <div class="flex items-center gap-1.5">
          <div class="w-2 h-2 rounded-full" style="background-color: var(--ui-primary)"></div>
          <span>代码行数</span>
        </div>
        <span class="font-medium">${d.lines.toLocaleString('zh-CN')}</span>
      </div>
      <div class="flex items-center justify-between text-sm gap-4">
        <div class="flex items-center gap-1.5">
          <div class="w-2 h-2 rounded-full" style="background-color: var(--ui-secondary)"></div>
          <span>文件数</span>
        </div>
        <span class="font-medium">${d.files.toLocaleString('zh-CN')}</span>
      </div>
      <div class="flex items-center justify-between text-sm gap-4">
        <div class="flex items-center gap-1.5">
          <div class="w-2 h-2 rounded-full" style="background-color: var(--ui-success)"></div>
          <span>提交次数</span>
        </div>
        <span class="font-medium">${d.commits.toLocaleString('zh-CN')}</span>
      </div>
      ${showSurvivalDays.value
        ? `<div class="flex items-center justify-between text-sm gap-4">
        <div class="flex items-center gap-1.5">
          <div class="w-2 h-2 rounded-full" style="background-color: var(--ui-warning)"></div>
          <span>存续天数</span>
        </div>
        <span class="font-medium">${d.survival_days.toLocaleString('zh-CN')}</span>
      </div>`
        : ''}
      <div class="flex items-center justify-between text-sm gap-4">
        <div class="flex items-center gap-1.5">
          <div class="w-2 h-2 rounded-full" style="background-color: var(--ui-error)"></div>
          <span>参与人数</span>
        </div>
        <span class="font-medium">${d.contributors}</span>
      </div>
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
        <div>
          <ULink
            color="primary"
            class="text-md text-highlighted font-semibold pr-2"
            @click="navigateToReport"
          >
            仓库规模TOP{{ limit }}
          </ULink>
          <UBadge
            v-if="year"
            color="primary"
            variant="subtle"
          >
            {{ year }} 年
          </UBadge>
        </div>
        <div class="flex flex-wrap items-center gap-3 text-xs">
          <div class="flex items-center gap-1.5">
            <div
              class="w-3 h-3 rounded"
              :style="{ backgroundColor: 'var(--ui-primary)' }"
            />
            <span>代码行数{{ formatScale(scaleFactors.lines) }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <div
              class="w-3 h-3 rounded"
              :style="{ backgroundColor: 'var(--ui-secondary)' }"
            />
            <span>文件数{{ formatScale(scaleFactors.files) }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <div
              class="w-3 h-3 rounded"
              :style="{ backgroundColor: 'var(--ui-success)' }"
            />
            <span>提交次数{{ formatScale(scaleFactors.commits) }}</span>
          </div>
          <div
            v-if="showSurvivalDays"
            class="flex items-center gap-1.5"
          >
            <div
              class="w-3 h-3 rounded"
              :style="{ backgroundColor: 'var(--ui-warning)' }"
            />
            <span>存续天数{{ formatScale(scaleFactors.survival) }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <div
              class="w-3 h-3 rounded"
              :style="{ backgroundColor: 'var(--ui-error)' }"
            />
            <span>参与人数</span>
          </div>
        </div>
      </div>
    </template>

    <div
      v-if="pending"
      class="h-90 flex items-center justify-center"
    >
      <USkeleton class="h-full w-full" />
    </div>

    <div
      v-else-if="chartData.length > 0"
      class="h-90 relative"
    >
      <VisXYContainer
        :data="chartData"
        :margin="{ top: 20, left: 10, right: 10, bottom: 20 }"
        class="h-90"
        :width="width"
      >
        <VisGroupedBar
          :x="x"
          :y="y"
          :color="colors"
        />

        <VisAxis
          type="x"
          :x="x"
          :tick-format="xTicks"
          :num-ticks="chartData.length"
        />

        <VisAxis
          type="y"
          label="数量"
        />

        <VisCrosshair
          :template="template"
          color="var(--ui-primary)"
        />

        <VisTooltip />
      </VisXYContainer>
    </div>
    <div
      v-else
      class="h-90 flex items-center justify-center text-muted"
    >
      暂无数据
    </div>
  </UCard>
</template>

<style scoped>
.unovis-xy-container {
  touch-action: pan-y;
  --vis-axis-grid-color: var(--ui-border);
  --vis-axis-tick-color: var(--ui-border);
  --vis-axis-tick-label-color: var(--ui-text-dimmed);

  --vis-tooltip-background-color: var(--ui-bg);
  --vis-tooltip-border-color: var(--ui-border);
  --vis-tooltip-text-color: var(--ui-text-highlighted);

  --vis-crosshair-line-stroke-color: var(--ui-primary);
  --vis-crosshair-circle-stroke-color: var(--ui-bg);
}
</style>
