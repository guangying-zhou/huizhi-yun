<script setup lang="ts">
import { VisXYContainer, VisGroupedBar, VisAxis, VisTooltip } from '@unovis/vue'

const { apiBase } = useApiBase()

interface DepartmentStats {
  department_id: number
  department_name: string
  total_commits: number
  files_added: number
  total_lines_added: number
  total_lines_deleted: number
  developer_count: number
  repo_count: number
}

interface ChartDataPoint {
  name: string
  commits: number
  repos: number
  developers: number
}

const props = defineProps<{
  year: number | null
  limit?: number
}>()

const cardRef = useTemplateRef<HTMLElement | null>('cardRef')
const { width } = useElementSize(cardRef)

const apiUrl = `${apiBase}/statistics/department-ranking`

const { data: departmentStats, pending, refresh, status } = useFetch<DepartmentStats[]>(() => apiUrl, {
  query: () => ({
    year: props.year ?? 0, // null 转换为 0
    limit: props.limit || 10
  }),
  server: false,
  immediate: true,
  default: () => []
})

watch(() => [props.year, props.limit], () => {
  refresh()
})

onMounted(() => {
  if (status.value === 'idle') refresh()
})

const chartData = computed<ChartDataPoint[]>(() => {
  if (!departmentStats.value || departmentStats.value.length === 0) return []

  return departmentStats.value.map(item => ({
    name: item.department_name || '未分配',
    commits: Number(item.total_commits) || 0,
    repos: Number(item.repo_count) || 0,
    developers: Number(item.developer_count) || 0
  }))
})

const x = (_: ChartDataPoint, i: number) => i
const y = [
  (d: ChartDataPoint) => d.commits / 10, // 缩放以便与其他指标对比
  (d: ChartDataPoint) => d.repos,
  (d: ChartDataPoint) => d.developers
]

const colors = ['var(--ui-primary)', 'var(--ui-success)', 'var(--ui-info)']

const xTicks = (i: number) => {
  if (!chartData.value[i]) return ''
  const name = chartData.value[i].name
  return name.length > 8 ? name.substring(0, 7) + '...' : name
}

const template = (d: ChartDataPoint) => {
  return `
    <div class="space-y-1">
      <div class="font-semibold">${d.name}</div>
      <div class="text-sm">提交数: ${d.commits.toLocaleString('zh-CN')}</div>
      <div class="text-sm">仓库数: ${d.repos}</div>
      <div class="text-sm">人员数: ${d.developers}</div>
    </div>
  `
}
</script>

<template>
  <UCard
    ref="cardRef"
    :ui="{ root: 'overflow-visible', body: '!px-0 !pt-0 !pb-3' }"
  >
    <template #header>
      <div class="flex items-center justify-between">
        <div>
          <p class="text-xs text-muted uppercase mb-1.5">
            部门贡献排行
          </p>
          <p class="text-sm text-muted">
            {{ year ? `${year} \u5e74` : '\u5168\u90e8\u5e74\u5ea6' }}
          </p>
        </div>
        <div class="flex items-center gap-3 text-xs">
          <div class="flex items-center gap-1.5">
            <div
              class="w-3 h-3 rounded"
              :style="{ backgroundColor: 'var(--ui-primary)' }"
            />
            <span>提交数 (÷10)</span>
          </div>
          <div class="flex items-center gap-1.5">
            <div
              class="w-3 h-3 rounded"
              :style="{ backgroundColor: 'var(--ui-success)' }"
            />
            <span>仓库数</span>
          </div>
          <div class="flex items-center gap-1.5">
            <div
              class="w-3 h-3 rounded"
              :style="{ backgroundColor: 'var(--ui-info)' }"
            />
            <span>人员数</span>
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

    <VisXYContainer
      v-else-if="chartData.length > 0"
      :data="chartData"
      :padding="{ top: 20, bottom: 60 }"
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
      />

      <VisAxis
        type="y"
        label="数量"
      />

      <VisTooltip :triggers="{ [VisTooltip.Trigger]: template }" />
    </VisXYContainer>

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
  --vis-axis-grid-color: var(--ui-border);
  --vis-axis-tick-color: var(--ui-border);
  --vis-axis-tick-label-color: var(--ui-text-dimmed);

  --vis-tooltip-background-color: var(--ui-bg);
  --vis-tooltip-border-color: var(--ui-border);
  --vis-tooltip-text-color: var(--ui-text-highlighted);
}
</style>
