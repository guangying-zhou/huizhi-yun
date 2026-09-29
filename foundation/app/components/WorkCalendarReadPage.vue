<script setup lang="ts">
import type { ConsoleWorkCalendar, ConsoleWorkCalendarMonth, ConsoleWorkCalendarDay } from '../types/consoleWorkCalendar'

usePageTitle('节假日管理')
const props = defineProps<{ apiPath: string, consolePath: string }>()
const current = new Date()
const year = ref(current.getFullYear())
const activeMonth = ref(current.getMonth() + 1)
const { data: calendars, pending: listPending, error: listError, refresh: refreshCalendars } = await useFetch<{ code: number, data: { items: ConsoleWorkCalendar[] } }>(props.apiPath)
const calendarCode = ref(calendars.value?.data.items[0]?.calendarCode || '')
const selectedCalendar = computed(() => calendars.value?.data.items.find(item => item.calendarCode === calendarCode.value))
const calendarOptions = computed(() => (calendars.value?.data.items || []).map(item => ({ label: `${item.calendarName} (${item.calendarCode})`, value: item.calendarCode })))
const validYear = computed(() => Number.isInteger(year.value) && year.value >= 2000 && year.value <= 2100)
const basePath = computed(() => `${props.apiPath}/${encodeURIComponent(calendarCode.value)}`)
const monthQuery = computed(() => ({ year: year.value }))
const dayQuery = computed(() => ({ yearMonth: `${year.value}-${String(activeMonth.value).padStart(2, '0')}` }))
const { data: months, pending: monthsPending, error: monthsError, execute: loadMonths, clear: clearMonths } = await useFetch<{ code: number, data: { items: ConsoleWorkCalendarMonth[] } }>(computed(() => `${basePath.value}/months`), { query: monthQuery, immediate: false, watch: false })
const { data: days, pending: daysPending, error: daysError, execute: loadDays, clear: clearDays } = await useFetch<{ code: number, data: { items: ConsoleWorkCalendarDay[] } }>(computed(() => `${basePath.value}/days`), { query: dayQuery, immediate: false, watch: false })
const error = computed(() => listError.value || monthsError.value || daysError.value)
const pending = computed(() => listPending.value || monthsPending.value || daysPending.value)
async function loadDetails() {
  clearMonths()
  clearDays()
  if (listError.value || !selectedCalendar.value || !validYear.value) return
  await Promise.all([loadMonths(), loadDays()])
}
async function refreshAll() {
  await refreshCalendars()
  if (!selectedCalendar.value) calendarCode.value = calendars.value?.data.items[0]?.calendarCode || ''
  await loadDetails()
}
watch([calendarCode, year], loadDetails)
watch(activeMonth, async () => {
  clearDays()
  if (!listError.value && selectedCalendar.value && validYear.value) await loadDays()
})
await loadDetails()
</script>

<template>
  <UDashboardPanel id="enterprise-work-calendar">
    <template #body>
      <ContentPageHeader hosted title="节假日管理" description="查看企业工作日历规则、月度工时和日明细。" />
      <div class="flex flex-wrap items-center gap-2">
        <USelect
          v-model="calendarCode"
          :items="calendarOptions"
          aria-label="工作日历"
          class="max-w-full"
        />
        <UInput
          v-model.number="year"
          type="number"
          min="2000"
          max="2100"
          aria-label="年份"
          class="w-32"
        />
        <span class="text-sm text-muted">{{ selectedCalendar?.standardHoursPerDay ?? '—' }} h/天</span>
        <UButton
          :to="consolePath"
          external
          color="neutral"
          variant="outline"
          label="在控制台导入"
        />
        <UButton
          :to="consolePath"
          external
          color="neutral"
          variant="outline"
          label="在控制台逐日编辑"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          aria-label="刷新工作日历"
          :loading="pending"
          @click="refreshAll"
        />
      </div>
      <CommonEmptyState v-if="error?.statusCode === 403" title="无权限" description="你没有查看工作日历配置的权限。" />
      <UAlert
        v-else-if="error"
        color="error"
        title="工作日历加载失败"
        description="请稍后重试。"
      />
      <UAlert
        v-else-if="!validYear"
        color="warning"
        title="年份无效"
        description="请输入2000至2100之间的整数年份。"
      />
      <USkeleton v-else-if="listPending" class="h-48" />
      <CommonEmptyState v-else-if="!selectedCalendar" title="暂无工作日历" description="请在控制台配置工作日历。" />
      <WorkCalendarOverview
        v-else
        v-model:month="activeMonth"
        :year="year"
        :months="months?.data.items || []"
        :days="days?.data.items || []"
        :loading="pending"
        :console-path="consolePath"
      />
    </template>
  </UDashboardPanel>
</template>
