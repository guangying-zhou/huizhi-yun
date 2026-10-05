<script setup lang="ts">
import type { ConsoleWorkCalendar as WorkCalendar, ConsoleWorkCalendarMonth as WorkCalendarMonth, ConsoleWorkCalendarDay as WorkCalendarDay, ConsoleWorkCalendarDayDraft as DayDraft } from '@hzy/foundation/app/types/consoleWorkCalendar'
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('节假日管理')

type ApiResponse<T> = {
  code: number
  data: T
  message?: string
}

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
function dayTypeIsWorkday(dayType: string) {
  return ['workday', 'transfer_workday', 'custom_workday'].includes(dayType)
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
      headers: {
        'idempotency-key': `console:work-calendar:import:${calendarCode.value}:${year.value}:${globalThis.crypto?.randomUUID?.() || Date.now()}`
      },
      body: {
        calendarCode: calendarCode.value,
        regionCode: regionCode.value,
        year: year.value,
        mode,
        dataset,
        standardHoursPerDay: Number(standardHoursPerDay.value) || 8,
        expectedRevision: selectedCalendar.value?.revision || 0
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
        headers: {
          'idempotency-key': `console:work-calendar:day:${calendarCode.value}:${day.workDate}:${globalThis.crypto?.randomUUID?.() || Date.now()}`
        },
        body: {
          ...draft,
          expectedRevision: day.revision
        }
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

        <WorkCalendarOverview
          v-model:month="activeMonth"
          :year="year"
          :months="months"
          :days="days"
          :loading="loading"
          :read-only="false"
          :can-edit="canEdit"
          :saving-date="savingDate"
          :day-drafts="dayDrafts"
          :is-dirty="isDirty"
          @day-type="setDraftDayType"
          @workday="setDraftWorkday"
          @holiday-name="setDraftHolidayName"
          @save="saveDay"
        />
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
