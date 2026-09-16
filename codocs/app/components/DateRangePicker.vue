<script setup lang="ts">
import { ref, shallowRef, computed } from 'vue'
import { CalendarDate, getLocalTimeZone, today } from '@internationalized/date'

interface DateRangeValue {
  start: CalendarDate
  end: CalendarDate
}

const props = withDefaults(defineProps<{
  defaultPreset?: 'current_month' | 'last_month' | 'current_year'
}>(), {
  defaultPreset: 'current_month'
})

const emit = defineEmits<{
  'update:startDate': [value: string]
  'update:endDate': [value: string]
}>()

// 获取当月日期范围
function getCurrentMonthRange(): DateRangeValue {
  const now = today(getLocalTimeZone())
  const firstDay = new CalendarDate(now.year, now.month, 1)
  return { start: firstDay, end: now }
}

// 获取上月日期范围
function getLastMonthRange(): DateRangeValue {
  const now = today(getLocalTimeZone())
  let year = now.year
  let month = now.month - 1
  if (month === 0) {
    month = 12
    year -= 1
  }
  const firstDay = new CalendarDate(year, month, 1)
  const lastDay = new CalendarDate(year, month, new Date(year, month, 0).getDate())
  return { start: firstDay, end: lastDay }
}

// 获取当年日期范围
function getCurrentYearRange(): DateRangeValue {
  const now = today(getLocalTimeZone())
  const firstDay = new CalendarDate(now.year, 1, 1)
  return { start: firstDay, end: now }
}

function getDefaultRange(): DateRangeValue {
  if (props.defaultPreset === 'last_month') return getLastMonthRange()
  if (props.defaultPreset === 'current_year') return getCurrentYearRange()
  return getCurrentMonthRange()
}

const dateRange = shallowRef<DateRangeValue>(getDefaultRange())

// 日期范围预设选项
const datePresets = [
  { label: '当月', value: 'current_month' },
  { label: '上月', value: 'last_month' },
  { label: '当年', value: 'current_year' }
]

const selectedPreset = ref(props.defaultPreset)
const datePopoverOpen = ref(false)

function selectPreset(preset: string) {
  selectedPreset.value = preset as typeof props.defaultPreset
  if (preset === 'current_month') {
    dateRange.value = getCurrentMonthRange()
  } else if (preset === 'last_month') {
    dateRange.value = getLastMonthRange()
  } else if (preset === 'current_year') {
    dateRange.value = getCurrentYearRange()
  }
  datePopoverOpen.value = false
}

// 转换 CalendarDate 为字符串格式 YYYY-MM-DD
const startDateStr = computed(() => {
  if (!dateRange.value?.start) return ''
  const d = dateRange.value.start
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
})

const endDateStr = computed(() => {
  if (!dateRange.value?.end) return ''
  const d = dateRange.value.end
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
})

// 暴露日期字符串供父组件使用
defineExpose({
  startDate: startDateStr,
  endDate: endDateStr
})

// 监听日期变化，发送事件
watch(dateRange, () => {
  emit('update:startDate', startDateStr.value)
  emit('update:endDate', endDateStr.value)
}, { deep: true, immediate: true })
</script>

<template>
  <UPopover v-model:open="datePopoverOpen">
    <UButton
      color="neutral"
      variant="outline"
      size="sm"
      icon="i-lucide-calendar"
    >
      {{ startDateStr }} — {{ endDateStr }}
    </UButton>
    <template #content>
      <div class="flex">
        <!-- 左侧预设选项 -->
        <div class="border-r border-gray-200 dark:border-gray-700 p-2 space-y-1">
          <UButton
            v-for="preset in datePresets"
            :key="preset.value"
            :label="preset.label"
            :color="selectedPreset === preset.value ? 'primary' : 'neutral'"
            :variant="selectedPreset === preset.value ? 'solid' : 'ghost'"
            size="sm"
            class="w-full justify-start"
            @click="selectPreset(preset.value)"
          />
        </div>
        <!-- 右侧日历 -->
        <UCalendar
          v-model="dateRange"
          class="p-2"
          :number-of-months="2"
          range
        />
      </div>
    </template>
  </UPopover>
</template>
