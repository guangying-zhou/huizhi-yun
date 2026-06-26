<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('节假日管理')

type ApiResponse<T> = {
  code: number
  data: T
  message?: string
}

type WorkCalendar = {
  calendarCode: string
  calendarName: string
  regionCode: string
  standardHoursPerDay: number
  weekendDays: number[]
  updatedAt: string
}

type WorkCalendarMonth = {
  calendarCode: string
  yearMonth: string
  yearNo: number
  monthNo: number
  workdayCount: number
  nonWorkdayCount: number
  standardHoursPerDay: number
  standardWorkHours: number
  source: string
  calculatedAt: string
}

type WorkCalendarDay = {
  id: number
  calendarCode: string
  workDate: string
  yearMonth: string
  dayOfWeek: number
  dayType: string
  isWorkday: boolean
  holidayName: string | null
  source: string
  remark: string | null
}

type DayDraft = {
  dayType: string
  isWorkday: boolean
  holidayName: string
  remark: string
}

type DetailViewMode = 'calendar' | 'list'

const toast = useToast()
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()
const currentDate = new Date()
const year = ref(currentDate.getFullYear())
const activeMonth = ref(currentDate.getMonth() + 1)
const calendarCode = ref('CN')
const regionCode = ref('CN')
const standardHoursPerDay = ref(8)
const calendars = ref<WorkCalendar[]>([])
const months = ref<WorkCalendarMonth[]>([])
const days = ref<WorkCalendarDay[]>([])
const loading = ref(false)
const importing = ref(false)
const savingDate = ref('')
const manualImportOpen = ref(false)
const manualJson = ref('')
const dayDrafts = ref<Record<string, DayDraft>>({})
const detailViewMode = ref<DetailViewMode>('calendar')

if (!permissionsLoaded.value) {
  await loadPermissions()
}

const canEdit = computed(() => permissionsLoaded.value && hasPermission('system_settings', 'edit'))
const activeYearMonth = computed(() => `${year.value}-${String(activeMonth.value).padStart(2, '0')}`)
const selectedCalendar = computed(() => calendars.value.find(item => item.calendarCode === calendarCode.value) || null)
const _calendarOptions = computed(() => calendars.value.map(item => ({
  label: `${item.calendarName} (${item.calendarCode})`,
  value: item.calendarCode
})))
const monthRows = computed(() => Array.from({ length: 12 }, (_, index) => {
  const monthNo = index + 1
  const yearMonth = `${year.value}-${String(monthNo).padStart(2, '0')}`
  const summary = months.value.find(item => item.yearMonth === yearMonth)
  return {
    monthNo,
    yearMonth,
    workdayCount: summary?.workdayCount ?? null,
    standardWorkHours: summary?.standardWorkHours ?? null,
    source: summary?.source || 'empty'
  }
}))
const selectedMonth = computed(() => months.value.find(item => item.yearMonth === activeYearMonth.value) || null)
const calendarCells = computed(() => {
  const leadingBlanks = days.value[0]?.dayOfWeek ?? 0
  return [
    ...Array.from({ length: leadingBlanks }, (_, index) => ({ key: `blank-${index}`, day: null as WorkCalendarDay | null })),
    ...days.value.map(day => ({ key: day.workDate, day }))
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
const detailViewOptions: Array<{ label: string, value: DetailViewMode, icon: string }> = [
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

function dayTypeIsWorkday(dayType: string) {
  return ['workday', 'transfer_workday', 'custom_workday'].includes(dayType)
}

function dayNumber(day: WorkCalendarDay | null) {
  if (!day) return ''
  return String(Number(day.workDate.slice(8, 10)))
}

function calendarDayClasses(day: WorkCalendarDay | null) {
  if (!day) return 'border-dashed border-default bg-muted/20'
  if (!day.isWorkday) return 'border-default bg-elevated'
  if (day.dayType === 'transfer_workday' || day.dayType === 'custom_workday') return 'border-warning bg-warning/5'
  return 'border-default bg-default'
}

function setDraftDayType(workDate: string, value: string) {
  const draft = dayDrafts.value[workDate]
  if (!draft) return
  draft.dayType = value
  draft.isWorkday = dayTypeIsWorkday(value)
}

function setDraftWorkday(workDate: string, value: boolean) {
  const draft = dayDrafts.value[workDate]
  if (!draft) return
  draft.isWorkday = value
}

function setDraftHolidayName(workDate: string, value: string) {
  const draft = dayDrafts.value[workDate]
  if (!draft) return
  draft.holidayName = value
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

function resetDayDrafts(items: WorkCalendarDay[]) {
  const nextDrafts: Record<string, DayDraft> = {}
  for (const day of items) {
    nextDrafts[day.workDate] = {
      dayType: day.dayType,
      isWorkday: day.isWorkday,
      holidayName: day.holidayName || '',
      remark: day.remark || ''
    }
  }
  dayDrafts.value = nextDrafts
}

function isDirty(day: WorkCalendarDay) {
  const draft = dayDrafts.value[day.workDate]
  if (!draft) return false
  return draft.dayType !== day.dayType
    || draft.isWorkday !== day.isWorkday
    || draft.holidayName !== (day.holidayName || '')
    || draft.remark !== (day.remark || '')
}

async function loadCalendars() {
  const res = await $fetch<ApiResponse<{ items: WorkCalendar[] }>>('/api/v1/console/work-calendars')
  calendars.value = res.data.items
  if (!calendars.value.some(item => item.calendarCode === calendarCode.value)) {
    calendarCode.value = calendars.value[0]?.calendarCode || 'CN'
  }
  const calendar = selectedCalendar.value
  if (calendar) {
    regionCode.value = calendar.regionCode
    standardHoursPerDay.value = calendar.standardHoursPerDay
  }
}

async function loadMonths() {
  const res = await $fetch<ApiResponse<{ items: WorkCalendarMonth[] }>>(
    `/api/v1/console/work-calendars/${encodeURIComponent(calendarCode.value)}/months`,
    { query: { year: year.value } }
  )
  months.value = res.data.items
}

async function loadDays() {
  const res = await $fetch<ApiResponse<{ items: WorkCalendarDay[] }>>(
    `/api/v1/console/work-calendars/${encodeURIComponent(calendarCode.value)}/days`,
    { query: { yearMonth: activeYearMonth.value } }
  )
  days.value = res.data.items
  resetDayDrafts(days.value)
}

async function refreshAll() {
  loading.value = true
  try {
    await loadCalendars()
    await loadMonths()
    await loadDays()
  } catch (error) {
    toast.add({ color: 'error', title: '加载失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    loading.value = false
  }
}

async function importYear(mode: 'auto' | 'manual') {
  if (!canEdit.value) {
    toast.add({ color: 'warning', title: '权限不足', description: '需要系统参数编辑权限。' })
    return
  }

  let dataset: unknown = undefined
  if (mode === 'manual') {
    try {
      dataset = JSON.parse(manualJson.value)
    } catch {
      toast.add({ color: 'error', title: 'JSON 格式错误' })
      return
    }
  }

  importing.value = true
  try {
    const res = await $fetch<ApiResponse<{ importedDays: number }>>('/api/v1/console/work-calendars/import-year', {
      method: 'POST',
      body: {
        calendarCode: calendarCode.value,
        regionCode: regionCode.value,
        year: year.value,
        mode,
        dataset,
        standardHoursPerDay: Number(standardHoursPerDay.value) || 8
      }
    })
    toast.add({
      color: 'success',
      title: mode === 'manual' ? '导入完成' : '自动获取完成',
      description: `已处理 ${year.value} 年 ${res.data.importedDays} 条节假日/调休记录`
    })
    manualImportOpen.value = false
    await refreshAll()
  } catch (error) {
    toast.add({ color: 'error', title: '导入失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    importing.value = false
  }
}

async function saveDay(day: WorkCalendarDay) {
  const draft = dayDrafts.value[day.workDate]
  if (!draft) return
  savingDate.value = day.workDate
  try {
    await $fetch(
      `/api/v1/console/work-calendars/${encodeURIComponent(calendarCode.value)}/days/${encodeURIComponent(day.workDate)}`,
      {
        method: 'PATCH',
        body: draft
      }
    )
    toast.add({ color: 'success', title: '已保存', description: day.workDate })
    await loadMonths()
    await loadDays()
  } catch (error) {
    toast.add({ color: 'error', title: '保存失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    savingDate.value = ''
  }
}

watch(calendarCode, async () => {
  const calendar = selectedCalendar.value
  if (calendar) {
    regionCode.value = calendar.regionCode
    standardHoursPerDay.value = calendar.standardHoursPerDay
  }
  await loadMonths()
  await loadDays()
})

watch(year, async () => {
  await loadMonths()
  await loadDays()
})

watch(activeMonth, async () => {
  await loadDays()
})

await refreshAll()
</script>

<template>
  <UDashboardPanel id="work-calendar" :ui="dashboardPanelUi">
    <template #body>
      <div class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <!-- <USelect
              v-model="calendarCode"
              :items="_calendarOptions"
              value-key="value"
              class="w-64"
            /> -->
            <UInput
              v-model.number="year"
              type="number"
              class="w-32"
              min="2000"
              max="2100"
            />
            <!-- <UInput
              v-model="regionCode"
              class="w-24"
              placeholder="CN"
            /> -->
            <UInput
              v-model.number="standardHoursPerDay"
              type="number"
              class="w-32"
              min="1"
              step="0.5"
            >
              <template #trailing>
                <span class="text-xs text-muted">h/天</span>
              </template>
            </UInput>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <UButton
              icon="i-lucide-cloud-download"
              label="自动获取"
              :loading="importing"
              :disabled="!canEdit"
              @click="importYear('auto')"
            />
            <UButton
              icon="i-lucide-file-input"
              label="手工导入"
              color="neutral"
              variant="outline"
              :disabled="!canEdit"
              @click="manualImportOpen = true"
            />
            <UButton
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              :loading="loading"
              @click="refreshAll"
            />
          </div>
        </div>

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
              <div class="grid grid-cols-7 rounded-t-md border border-default bg-muted text-center text-xs font-medium text-muted">
                <div
                  v-for="weekday in weekdayHeaders"
                  :key="weekday"
                  class="border-r border-default px-2 py-2 last:border-r-0"
                >
                  {{ weekday }}
                </div>
              </div>

              <div class="grid grid-cols-7 gap-2 pt-3">
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
              <table class="min-w-full divide-y divide-default text-sm">
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
                          v-if="dayDrafts[day.workDate]"
                          :model-value="dayDrafts[day.workDate]?.dayType || day.dayType"
                          :items="dayTypeOptions"
                          value-key="value"
                          size="sm"
                          class="w-36"
                          :disabled="!canEdit"
                          @update:model-value="value => setDraftDayType(day.workDate, String(value))"
                        />
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <USwitch
                        v-if="dayDrafts[day.workDate]"
                        :model-value="dayDrafts[day.workDate]?.isWorkday || false"
                        :disabled="!canEdit"
                        @update:model-value="value => setDraftWorkday(day.workDate, Boolean(value))"
                      />
                    </td>
                    <td class="px-4 py-3">
                      <UInput
                        v-if="dayDrafts[day.workDate]"
                        :model-value="dayDrafts[day.workDate]?.holidayName || ''"
                        size="sm"
                        placeholder="-"
                        class="w-44"
                        :disabled="!canEdit"
                        @update:model-value="value => setDraftHolidayName(day.workDate, String(value))"
                      />
                    </td>
                    <td class="whitespace-nowrap px-4 py-3">
                      <UBadge color="neutral" variant="subtle">
                        {{ sourceLabel(day.source) }}
                      </UBadge>
                    </td>
                    <td class="px-4 py-3 text-right">
                      <UButton
                        icon="i-lucide-save"
                        size="sm"
                        variant="ghost"
                        :loading="savingDate === day.workDate"
                        :disabled="!canEdit || !isDirty(day)"
                        @click="saveDay(day)"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="manualImportOpen" title="手工导入假期日历" :ui="{ content: 'sm:max-w-3xl' }">
    <template #body>
      <UTextarea
        v-model="manualJson"
        :rows="16"
        class="font-mono"
        placeholder="{ &quot;year&quot;: 2026, &quot;region&quot;: &quot;CN&quot;, &quot;dates&quot;: [...] }"
      />
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="manualImportOpen = false">
          取消
        </UButton>
        <UButton :loading="importing" :disabled="!manualJson.trim()" @click="importYear('manual')">
          导入
        </UButton>
      </div>
    </template>
  </UModal>
</template>
