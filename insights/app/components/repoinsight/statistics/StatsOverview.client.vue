<script setup lang="ts">
interface OverallStats {
  totalCommits: number
  totalCommitsChange: number
  activeRepos: number
  activeReposChange: number
  activeDevelopers: number
  activeDevelopersChange: number
  totalLines: number
  totalLinesChange: number
  submissionQuality: number
  submissionQualityChange: number
  workload: number
  workloadChange: number
}

const { apiBase } = useApiBase()

const props = defineProps<{
  year: number | null
  displayOnly: boolean
}>()

const currentChart = ref<'activity' | 'commits' | 'code' | null>(props.displayOnly ? null : 'commits')

const emit = defineEmits<{
  (e: 'chart-selected', type: 'activity' | 'commits' | 'code' | null): void
}>()

const selectChart = (type: 'activity' | 'commits' | 'code' | null) => {
  if (props.displayOnly) return
  currentChart.value = type
  emit('chart-selected', type)
}

const stats = ref<OverallStats>({
  totalCommits: 0,
  totalCommitsChange: 0,
  activeRepos: 0,
  activeReposChange: 0,
  activeDevelopers: 0,
  activeDevelopersChange: 0,
  totalLines: 0,
  totalLinesChange: 0,
  submissionQuality: 0,
  submissionQualityChange: 0,
  workload: 0,
  workloadChange: 0
})

const pending = ref(false)

async function loadStats() {
  pending.value = true
  try {
    const yearParam = props.year ?? 0
    console.log('[StatsOverview] Loading stats with year:', { propsYear: props.year, yearParam })

    const result = await $fetch<OverallStats>(`${apiBase}/statistics/overview`, {
      params: { year: yearParam }
    })

    console.log('[StatsOverview] Received data:', result)

    stats.value = {
      totalCommits: Number(result.totalCommits) || 0,
      totalCommitsChange: Number(result.totalCommitsChange) || 0,
      activeRepos: Number(result.activeRepos) || 0,
      activeReposChange: Number(result.activeReposChange) || 0,
      activeDevelopers: Number(result.activeDevelopers) || 0,
      activeDevelopersChange: Number(result.activeDevelopersChange) || 0,
      totalLines: Number(result.totalLines) || 0,
      totalLinesChange: Number(result.totalLinesChange) || 0,
      submissionQuality: Number(result.submissionQuality) || 0,
      submissionQualityChange: Number(result.submissionQualityChange) || 0,
      workload: Number(result.workload) || 0,
      workloadChange: Number(result.workloadChange) || 0
    }
  } catch (error) {
    console.error('[StatsOverview] Failed to load stats:', error)
  } finally {
    pending.value = false
  }
}

// 初始加载
await loadStats()

// 监听 year 变化
watch(() => props.year, () => {
  console.log('[StatsOverview] Year changed, reloading stats')
  loadStats()
})

const formatNumber = (value: number): string => {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`
  }
  return value.toLocaleString('zh-CN')
}

const statCards = computed(() => [
  {
    title: '有效仓库',
    icon: 'i-lucide-folder-git',
    value: formatNumber(stats.value.activeRepos),
    change: stats.value.activeReposChange,
    color: 'success',
    type: 'activity' as const
  },
  {
    title: '参与人数',
    icon: 'i-lucide-users',
    value: formatNumber(stats.value.activeDevelopers),
    change: stats.value.activeDevelopersChange,
    color: 'info',
    type: 'activity' as const
  },
  {
    title: '提交次数',
    icon: 'i-lucide-git-graph',
    value: formatNumber(stats.value.totalCommits),
    change: stats.value.totalCommitsChange,
    color: 'primary',
    type: 'commits' as const
  },
  {
    title: '提交质量',
    icon: 'i-lucide-copy-check',
    value: `${stats.value.submissionQuality.toFixed(1)}%`,
    change: stats.value.submissionQualityChange,
    color: 'secondary',
    type: 'commits' as const
  },
  {
    title: '加权行数',
    icon: 'i-lucide-monitor-check',
    value: formatNumber(stats.value.workload),
    change: stats.value.workloadChange,
    color: 'success',
    type: 'code' as const
  },
  {
    title: '净增行数',
    icon: 'i-lucide-code',
    value: formatNumber(stats.value.totalLines),
    change: stats.value.totalLinesChange,
    color: 'warning',
    type: 'code' as const
  }
])
</script>

<template>
  <UPageGrid class="lg:grid-cols-6 gap-2 gap-x-4 sm:gap-px pt-1">
    <UPageCard
      v-for="(stat, index) in statCards"
      :key="index"
      :icon="stat.icon"
      :title="stat.title"
      variant="subtle"
      spotlight
      orientation="horizontal"
      :ui="{
        container: 'gap-y-1 lg:p-1.5',
        wrapper: 'items-center',
        leading: `p-2 rounded-full bg-${stat.color}/10 ring ring-inset ml-1 ring-${stat.color}/25 flex-col`,
        title: 'font-normal text-muted text-xs uppercase items-start pt-0',
        body: '!px-0 !pt-0 !pb-0 !m-0'
      }"
      class="p-0 lg:rounded-none first:rounded-l-lg last:rounded-r-lg hover:z-1 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 relative"
      :class="{ 'border-b-2 border-b-primary-500': currentChart === stat.type }"
      @click="selectChart(stat.type)"
    >
      <template v-if="!pending">
        <div class="flex items-start gap-1">
          <span class="text-2xl font-semibold text-highlighted">
            {{ stat.value }}
          </span>
          <UBadge
            v-if="props.year !== 0 && stat.change !== 0"
            :color="stat.change > 0 ? 'success' : 'error'"
            variant="subtle"
            size="xs"
            class="text-xs"
          >
            {{ stat.change > 0 ? '+' : '' }}{{ stat.change }}%
          </UBadge>
        </div>
      </template>
      <template v-else>
        <USkeleton class="h-8 w-24" />
      </template>
    </UPageCard>
  </UPageGrid>
</template>
