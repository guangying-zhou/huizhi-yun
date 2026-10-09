<script setup lang="ts">
import { format, parseISO, getDay, startOfWeek, differenceInCalendarDays, addDays, subDays } from 'date-fns'

const props = defineProps<{
  personId: number
  year?: number
}>()

interface DailyStat {
  date: string // YYYY-MM-DD
  count: number
}

const { apiBase } = useApiBase()

const stats = ref<DailyStat[]>([])
const years = ref<number[]>([])
const selectedYear = ref<number>(props.year || new Date().getFullYear())
const pending = ref(true)
const isTransitioning = ref(false)
const isMounted = ref(true)

const emit = defineEmits<{
  (e: 'year-selected', year: number): void
}>()

onUnmounted(() => {
  isMounted.value = false
})

// Fetch available years
async function loadYears() {
  try {
    const data = await $fetch<number[]>(`${apiBase}/dashboard/contributors/${props.personId}/heatmap_years`)
    if (!isMounted.value) return // Guard against unmounted updates
    years.value = data
    if (years.value.length > 0 && !years.value.includes(selectedYear.value)) {
      selectedYear.value = years.value[0] ?? new Date().getFullYear()
    }
    emit('year-selected', selectedYear.value)
  } catch (e) {
    console.error('Failed to load years', e)
  }
}

// Fetch data
async function loadStats() {
  isTransitioning.value = true
  try {
    const data = await $fetch<DailyStat[]>(`${apiBase}/dashboard/contributors/${props.personId}/heatmap`, {
      query: { year: selectedYear.value }
    })
    if (!isMounted.value) return // Guard against unmounted updates
    stats.value = data
  } catch (e) {
    console.error('Failed to load daily stats', e)
  } finally {
    if (isMounted.value) {
      pending.value = false
      // Small delay to ensure smooth transition
      setTimeout(() => {
        if (isMounted.value) isTransitioning.value = false
      }, 50)
    }
  }
}

watch(() => props.personId, async () => {
  await loadYears()
  loadStats()
}, { immediate: true })

watch(selectedYear, (newYear) => {
  loadStats()
  emit('year-selected', newYear)
})

// Chart configuration
const cellSize = 11
const cellGap = 2
const monthLabelHeight = 20
const dayLabelWidth = 20
const height = 7 * (cellSize + cellGap) + monthLabelHeight

// Colors
function getColor(count: number) {
  if (count === 0) return '#ebedf0'
  if (count <= 3) return '#9be9a8'
  if (count <= 6) return '#40c463'
  if (count <= 9) return '#30a14e'
  return '#216e39'
}

function getDarkColor(count: number) {
  if (count === 0) return '#2d333b'
  if (count <= 3) return '#0e4429'
  if (count <= 6) return '#006d32'
  if (count <= 9) return '#26a641'
  return '#39d353'
}

const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')

function getCellColor(count: number) {
  return isDark.value ? getDarkColor(count) : getColor(count)
}

const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']

const chartData = computed(() => {
  if (!stats.value) return { cells: [], months: [], width: 0 }

  const dataMap = new Map(stats.value.map(d => [d.date, d.count]))
  const y = selectedYear.value
  const endDate = new Date(y, 11, 31)
  const startDate = new Date(y, 0, 1)
  const startSunday = startOfWeek(startDate)
  const days = differenceInCalendarDays(endDate, startSunday) + 1

  const cells = []
  const months = []
  let currentMonth = -1

  for (let i = 0; i < days; i++) {
    const date = addDays(startSunday, i)
    const dateStr = format(date, 'yyyy-MM-dd')
    const count = dataMap.get(dateStr) || 0
    const dayOfWeek = getDay(date)
    const weekIndex = Math.floor(i / 7)

    if (date < startDate || date > endDate) continue

    cells.push({
      date: dateStr,
      count,
      x: dayLabelWidth + weekIndex * (cellSize + cellGap),
      y: monthLabelHeight + dayOfWeek * (cellSize + cellGap),
      color: getCellColor(count)
    })

    if (date.getMonth() !== currentMonth && dayOfWeek === 0) {
      currentMonth = date.getMonth()
      months.push({
        label: monthNames[date.getMonth()],
        x: dayLabelWidth + weekIndex * (cellSize + cellGap),
        y: monthLabelHeight - 5
      })
    }
  }

  return { cells, months, width: dayLabelWidth + Math.ceil(days / 7) * (cellSize + cellGap) }
})

const totalContributions = computed(() => {
  return stats.value.reduce((acc, curr) => acc + curr.count, 0)
})
</script>

<template>
  <UCard :ui="{ body: 'p-3' }">
    <template #header>
      <div class="flex items-center justify-between">
        <h3 class="text-base font-semibold">
          提交热力图
        </h3>
      </div>
    </template>
    <div class="flex flex-col md:flex-row gap-3 justify-center h-52">
      <div class="overflow-x-auto h-full pt-4">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm">
            {{ selectedYear }} 年共有 {{ totalContributions }} 次提交
          </h3>
          <div class="flex items-center gap-2 text-xs text-muted-500">
            <span>更少</span>
            <div class="flex gap-1">
              <div
                class="w-2.5 h-2.5 rounded-sm"
                :style="{ backgroundColor: getCellColor(0) }"
              />
              <div
                class="w-2.5 h-2.5 rounded-sm"
                :style="{ backgroundColor: getCellColor(2) }"
              />
              <div
                class="w-2.5 h-2.5 rounded-sm"
                :style="{ backgroundColor: getCellColor(5) }"
              />
              <div
                class="w-2.5 h-2.5 rounded-sm"
                :style="{ backgroundColor: getCellColor(8) }"
              />
              <div
                class="w-2.5 h-2.5 rounded-sm"
                :style="{ backgroundColor: getCellColor(11) }"
              />
            </div>
            <span>更多</span>
          </div>
        </div>

        <div class="overflow-x-auto pb-2 ">
          <!-- Initial loading state -->
          <div
            v-if="pending && chartData.cells.length === 0"
            class="h-[100px] flex items-center justify-center"
          >
            <UIcon
              name="i-lucide-loader-2"
              class="w-6 h-6 animate-spin text-muted-400"
            />
          </div>

          <!-- Chart with smooth transition -->
          <div
            v-else
            class="relative"
          >
            <!-- Loading overlay -->
            <div
              v-if="isTransitioning"
              class="absolute inset-0 flex items-center justify-center z-10"
            >
              <UIcon
                name="i-lucide-loader-2"
                class="w-5 h-5 animate-spin text-muted-400"
              />
            </div>

            <svg
              :width="chartData.width"
              :height="height"
              class="text-xs transition-opacity duration-200"
              :class="{ 'opacity-40': isTransitioning }"
            >
              <text
                :x="0"
                :y="monthLabelHeight + (cellSize + cellGap) * 1 + 9"
                class="fill-gray-500 dark:fill-gray-400"
              >一</text>
              <text
                :x="0"
                :y="monthLabelHeight + (cellSize + cellGap) * 3 + 9"
                class="fill-gray-500 dark:fill-gray-400"
              >三</text>
              <text
                :x="0"
                :y="monthLabelHeight + (cellSize + cellGap) * 5 + 9"
                class="fill-gray-500 dark:fill-gray-400"
              >五</text>

              <text
                v-for="(month, i) in chartData.months"
                :key="i"
                :x="month.x"
                :y="month.y"
                class="fill-gray-500 dark:fill-gray-400"
              >
                {{ month.label }}
              </text>

              <rect
                v-for="(cell, i) in chartData.cells"
                :key="i"
                :x="cell.x"
                :y="cell.y"
                :width="cellSize"
                :height="cellSize"
                :fill="cell.color"
                class="rounded-sm hover:stroke-2 hover:stroke-gray-400 dark:hover:stroke-gray-500 cursor-pointer"
              >
                <title>{{ cell.count }} contributions on {{ cell.date }}</title>
              </rect>
            </svg>
          </div>
        </div>
      </div>

      <div
        v-if="years.length > 0"
        class="flex flex-row md:flex-col pt-2 gap-2 overflow-x-auto md:overflow-y-auto md:overflow-x-hidden md:max-h-full scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-700 scrollbar-track-transparent pr-1"
      >
        <UButton
          v-for="y in years"
          :key="y"
          :label="String(y)"
          :variant="selectedYear === y ? 'solid' : 'soft'"
          :color="selectedYear === y ? 'primary' : 'neutral'"
          size="xs"
          class="justify-center min-w-[60px]"
          @click="selectedYear = y"
        />
      </div>
    </div>
  </UCard>
</template>
