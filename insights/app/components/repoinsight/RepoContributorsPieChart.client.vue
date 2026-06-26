<script setup lang="ts">
import { VisSingleContainer, VisDonut, VisTooltip, VisBulletLegend } from '@unovis/vue'
import { Donut } from '@unovis/ts'

const props = defineProps<{
  repoId: number
  year?: number
}>()

interface ContributorStat {
  name: string
  value: number
}

const { apiBase } = useApiBase()

// Always fetch all-time stats, ignoring the year prop for the chart data
const { data: stats, pending } = await useFetch<ContributorStat[]>(() => `${apiBase}/repos/${props.repoId}/stats/contributors`, {
  // query: computed(() => ({
  //     year: props.year
  // })),
  // watch: [() => props.year]
})

const processedStats = computed(() => {
  if (!stats.value || stats.value.length === 0) return []

  const sorted = [...stats.value].sort((a, b) => b.value - a.value)
  // If we have 6 or fewer items, showing "Others" (which takes 1 slot) doesn't save space compared to showing the 6th item.
  // So we show all items if count <= 6.
  if (sorted.length <= 6) return sorted

  const top5 = sorted.slice(0, 5)
  const others = sorted.slice(5)
  const othersValue = others.reduce((sum, item) => sum + item.value, 0)

  return [
    ...top5,
    { name: '其他', value: othersValue }
  ]
})

const totalValue = computed(() => {
  if (!stats.value) return 0
  return stats.value.reduce((sum, item) => sum + item.value, 0)
})

const valueFn = (d: ContributorStat) => d.value

const colors = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#6366f1',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4',
  '#84cc16', '#a855f7'
]
// Chart uses full color palette
const colorFn = (_: ContributorStat, i: number) => colors[i % colors.length]

// Legend uses specific colors: Top 5 match chart, Others is grey
const legendItems = computed(() => {
  return processedStats.value.map((item, index) => {
    const isOthers = item.name === '其他'
    const percentage = ((item.value / totalValue.value) * 100).toFixed(1)
    return {
      ...item,
      name: `${item.name} ${percentage}%`,
      color: isOthers ? '#9ca3af' : colors[index % colors.length]
    }
  })
})

const hoveredItem = ref<ContributorStat | null>(null)

const events = {
  [Donut.selectors.segment]: {
    mouseover: (d: { data: ContributorStat }) => {
      hoveredItem.value = d.data
    },
    mouseout: () => {
      hoveredItem.value = null
    }
  }
}

const centralLabel = computed(() => hoveredItem.value ? hoveredItem.value.name : '')
const centralSubLabel = computed(() => {
  if (!hoveredItem.value) return ''
  const percentage = ((hoveredItem.value.value / totalValue.value) * 100).toFixed(1)
  return `${hoveredItem.value.value} (${percentage}%)`
})
</script>

<template>
  <UCard
    v-if="stats && stats.length > 0"
    :ui="{ body: 'sm:p-1', root: 'ring-0' }"
  >
    <div class="flex items-center justify-center mb-4">
      <span class="text-sm font-semibold">
        贡献者代码行数占比
      </span>
    </div>

    <div class="flex flex-col items-center gap-8">
      <div class="w-64 h-64 flex-shrink-0">
        <VisSingleContainer
          :data="stats"
          :height="256"
        >
          <VisDonut
            :value="valueFn"
            :color="colorFn"
            :sort-function="(a: ContributorStat, b: ContributorStat) => b.value - a.value"
            :arc-width="60"
            :events="events"
            :central-label="centralLabel"
            :central-sub-label="centralSubLabel"
          />
        </VisSingleContainer>
      </div>

      <div class="w-full flex items-center justify-center">
        <VisBulletLegend :items="legendItems" />
      </div>
    </div>
  </UCard>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
    width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
    background-color: rgba(156, 163, 175, 0.5);
    border-radius: 3px;
}
</style>
