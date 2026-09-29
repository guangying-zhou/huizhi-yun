<script setup lang="ts">
import type { ConsoleWorkCalendarMonth, ConsoleWorkCalendarDay, ConsoleWorkCalendarDayDraft, ConsoleWorkCalendarViewMode } from '../types/consoleWorkCalendar'

const props = withDefaults(defineProps<{ year: number, months: ConsoleWorkCalendarMonth[], days: ConsoleWorkCalendarDay[], loading?: boolean, readOnly?: boolean, canEdit?: boolean, savingDate?: string, dayDrafts?: Record<string, ConsoleWorkCalendarDayDraft>, isDirty?: (day: ConsoleWorkCalendarDay) => boolean, consolePath?: string }>(), { readOnly: true, canEdit: false, dayDrafts: () => ({}), isDirty: () => false, consolePath: '/console/work-calendar' })
const emit = defineEmits<{ dayType: [date: string, value: string], workday: [date: string, value: boolean], holidayName: [date: string, value: string], save: [day: ConsoleWorkCalendarDay] }>()
const activeMonth = defineModel<number>('month', { required: true })
const detailViewMode = ref<ConsoleWorkCalendarViewMode>('calendar')
const activeYearMonth = computed(() => `${props.year}-${String(activeMonth.value).padStart(2, '0')}`)
const monthRows = computed(() => Array.from({ length: 12 }, (_, index) => {
  const monthNo = index + 1
  const yearMonth = `${props.year}-${String(monthNo).padStart(2, '0')}`
  const summary = props.months.find(item => item.yearMonth === yearMonth)
  return {
    monthNo,
    yearMonth,
    workdayCount: summary?.workdayCount ?? null,
    standardWorkHours: summary?.standardWorkHours ?? null,
    source: summary?.source || 'empty'
  }
}))
const selectedMonth = computed(() => props.months.find(item => item.yearMonth === activeYearMonth.value) || null)
const calendarCells = computed(() => {
  const leadingBlanks = props.days[0]?.dayOfWeek ?? 0
  return [
    ...Array.from({ length: leadingBlanks }, (_, index) => ({ key: `blank-${index}`, day: null as ConsoleWorkCalendarDay | null })),
    ...props.days.map(day => ({ key: day.workDate, day }))
  ]
})

const dayTypeOptions = [
  { label: '普通工作日', value: 'workday' },
  { label: '周末', value: 'weekend' },
  { label: '法定假日', value: 'public_holiday' },
  { label: '调休工作日', value: 'transfer_workday' },
  { label: '自定义假日', value: 'custom_holiday' },
  { label: '自定义工作日', value: 'custom_workday' }
]
const detailViewOptions: Array<{ label: string, value: ConsoleWorkCalendarViewMode, icon: string }> = [
  { label: '日历', value: 'calendar', icon: 'i-lucide-calendar-days' },
  { label: '列表', value: 'list', icon: 'i-lucide-list' }
]
const weekdayHeaders = ['日', '一', '二', '三', '四', '五', '六']

function weekdayLabel(dayOfWeek: number) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dayOfWeek] || '-'
}

function dayTypeLabel(dayType: string) {
  return dayTypeOptions.find(item => item.value === dayType)?.label || dayType
}

function dayTypeColor(dayType: string) {
  if (dayType === 'public_holiday' || dayType === 'custom_holiday') return 'error' as const
  if (dayType === 'transfer_workday' || dayType === 'custom_workday') return 'warning' as const
  if (dayType === 'workday') return 'success' as const
  return 'neutral' as const
}

function dayNumber(day: ConsoleWorkCalendarDay | null) {
  if (!day) return ''
  return String(Number(day.workDate.slice(8, 10)))
}

function calendarDayClasses(day: ConsoleWorkCalendarDay | null) {
  if (!day) return 'border-dashed border-default bg-muted/20'
  if (!day.isWorkday) return 'border-default bg-elevated'
  if (day.dayType === 'transfer_workday' || day.dayType === 'custom_workday') return 'border-warning bg-warning/5'
  return 'border-default bg-default'
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    'generated': '生成',
    'holiday-calendar': '自动',
    'manual-import': '导入',
    'manual': '手工',
    'empty': '未生成'
  }
  return labels[source] || source
}
</script>

<template>
  <div class="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
    <UCard :ui="{ body: 'p-0' }">
      <template #header>
        <div class="flex items-center justify-between">
          <div>
            <p class="font-semibold">
              {{ year }} 年月度工时
            </p>
            <!-- <p class="text-xs text-muted">
                    {{ selectedCalendar?.calendarName || calendarCode }}
                  </p> -->
          </div>
          <!-- <UBadge color="neutral" variant="subtle">
                  {{ months.length }}/12
                </UBadge> -->
        </div>
      </template>

      <div class="space-y-2 px-0 py-2">
        <button
          v-for="month in monthRows"
          :key="month.yearMonth"
          type="button"
          class="flex w-full items-center justify-between gap-3 rounded-md border px-2 py-2 text-left transition hover:bg-elevated"
          :class="activeMonth === month.monthNo ? 'border-primary bg-primary/5' : 'border-default bg-default'"
          @click="activeMonth = month.monthNo"
        >
          <div class="flex min-w-0 items-center gap-2">
            <span class="w-12 shrink-0 font-medium">{{ month.monthNo }} 月</span>
            <UBadge
              size="xs"
              :color="month.source === 'empty' ? 'neutral' : 'success'"
              variant="subtle"
            >
              {{ sourceLabel(month.source) }}
            </UBadge>
          </div>
          <div class="flex shrink-0 items-center gap-3 text-xs text-muted">
            <span>工作日 <strong class="font-semibold text-highlighted">{{ month.workdayCount ?? '-' }}</strong></span>
            <span>工时 <strong class="font-semibold text-highlighted">{{ month.standardWorkHours ?? '-' }}</strong></span>
          </div>
        </button>
      </div>
    </UCard>

    <UCard :ui="{ body: 'p-0' }">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p class="font-semibold">
              {{ activeYearMonth }} 日历明细
            </p>
            <p class="text-xs text-muted">
              工作日 {{ selectedMonth?.workdayCount ?? '-' }} 天 · 标准工时 {{ selectedMonth?.standardWorkHours ?? '-' }}
            </p>
          </div>
          <UButtonGroup size="sm">
            <UButton
              v-for="option in detailViewOptions"
              :key="option.value"
              :icon="option.icon"
              :label="option.label"
              :color="detailViewMode === option.value ? 'primary' : 'neutral'"
              :variant="detailViewMode === option.value ? 'solid' : 'subtle'"
              @click="detailViewMode = option.value"
            />
          </UButtonGroup>
        </div>
      </template>

      <div v-if="loading" class="space-y-3 p-4">
        <USkeleton v-for="i in 6" :key="i" class="h-10 w-full" />
      </div>

      <div v-else-if="!days.length" class="p-10 text-center text-sm text-muted">
        暂无日历明细
      </div>

      <div v-else-if="detailViewMode === 'calendar'" class="max-h-[calc(100vh-260px)] overflow-auto p-3">
        <div class="grid min-w-[560px] grid-cols-7 rounded-t-md border border-default bg-muted text-center text-xs font-medium text-muted">
          <div
            v-for="weekday in weekdayHeaders"
            :key="weekday"
            class="border-r border-default px-2 py-2 last:border-r-0"
          >
            {{ weekday }}
          </div>
        </div>

        <div class="grid min-w-[560px] grid-cols-7 gap-2 pt-3">
          <div
            v-for="cell in calendarCells"
            :key="cell.key"
            class="min-h-28 rounded-md border p-3"
            :class="calendarDayClasses(cell.day)"
          >
            <template v-if="cell.day">
              <div class="flex items-start justify-between gap-2">
                <span class="text-lg font-semibold leading-none">
                  {{ dayNumber(cell.day) }}
                </span>
                <UBadge
                  size="xs"
                  :color="dayTypeColor(cell.day.dayType)"
                  variant="subtle"
                >
                  {{ dayTypeLabel(cell.day.dayType) }}
                </UBadge>
              </div>
              <p class="mt-3 truncate text-sm font-medium">
                {{ cell.day.holidayName || dayTypeLabel(cell.day.dayType) }}
              </p>
              <div class="mt-2 flex items-center justify-between gap-2 text-xs text-muted">
                <span>{{ weekdayLabel(cell.day.dayOfWeek) }}</span>
                <span>{{ sourceLabel(cell.day.source) }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <div v-else class="max-h-[calc(100vh-260px)] overflow-auto">
        <table class="min-w-[640px] w-full divide-y divide-default text-sm">
          <thead class="sticky top-0 z-10 bg-muted text-left text-xs font-medium text-muted">
            <tr>
              <th class="px-4 py-3">
                日期
              </th>
              <th class="px-4 py-3">
                类型
              </th>
              <th class="px-4 py-3">
                工作日
              </th>
              <th class="px-4 py-3">
                名称
              </th>
              <th class="px-4 py-3">
                来源
              </th>
              <th class="px-4 py-3 text-right">
                操作
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-for="day in days" :key="day.workDate">
              <td class="whitespace-nowrap px-4 py-3">
                <div class="font-medium">
                  {{ day.workDate }}
                </div>
                <div class="text-xs text-muted">
                  {{ weekdayLabel(day.dayOfWeek) }}
                </div>
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center gap-2">
                  <UBadge :color="dayTypeColor(dayDrafts[day.workDate]?.dayType || day.dayType)" variant="subtle">
                    {{ dayTypeLabel(dayDrafts[day.workDate]?.dayType || day.dayType) }}
                  </UBadge>
                  <USelect
                    v-if="!readOnly && dayDrafts[day.workDate]"
                    :model-value="dayDrafts[day.workDate]?.dayType || day.dayType"
                    :items="dayTypeOptions"
                    value-key="value"
                    size="sm"
                    class="w-36"
                    :disabled="!canEdit"
                    @update:model-value="value => emit('dayType', day.workDate, String(value))"
                  />
                </div>
              </td>
              <td class="px-4 py-3">
                <span v-if="readOnly">{{ day.isWorkday ? '是' : '否' }}</span>
                <USwitch
                  v-if="!readOnly && dayDrafts[day.workDate]"
                  :model-value="dayDrafts[day.workDate]?.isWorkday || false"
                  :disabled="!canEdit"
                  @update:model-value="value => emit('workday', day.workDate, Boolean(value))"
                />
              </td>
              <td class="px-4 py-3">
                <span v-if="readOnly">{{ day.holidayName || '—' }}</span>
                <UInput
                  v-if="!readOnly && dayDrafts[day.workDate]"
                  :model-value="dayDrafts[day.workDate]?.holidayName || ''"
                  size="sm"
                  placeholder="-"
                  class="w-44"
                  :disabled="!canEdit"
                  @update:model-value="value => emit('holidayName', day.workDate, String(value))"
                />
              </td>
              <td class="whitespace-nowrap px-4 py-3">
                <UBadge color="neutral" variant="subtle">
                  {{ sourceLabel(day.source) }}
                </UBadge>
              </td>
              <td class="px-4 py-3 text-right">
                <UButton
                  v-if="readOnly"
                  :to="consolePath"
                  external
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  label="在控制台编辑"
                />
                <UButton
                  v-else
                  icon="i-lucide-save"
                  size="sm"
                  variant="ghost"
                  :loading="savingDate === day.workDate"
                  :disabled="!canEdit || !isDirty(day)"
                  @click="emit('save', day)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
