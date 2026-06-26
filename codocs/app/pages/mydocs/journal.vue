<script setup lang="ts">
/**
 * 日志周报页面
 * 左侧日历（日志模式按天选择，周报模式按周选择），右侧查看/编辑
 * 通过页签切换日志/周报模式
 */

definePageMeta({ layout: 'default' })

usePageTitle('日志周报')

// ==================== 类型定义 ====================

interface WorklogListItem {
  uuid: string
  title: string
  date: string
}

interface WeeklyReportItem {
  uuid: string
  title: string
  year: number
  week: number
}

interface WorklogListResponse {
  success: boolean
  data?: { items: WorklogListItem[] }
}

interface WeeklyReportListResponse {
  success: boolean
  data?: { items: WeeklyReportItem[] }
}

interface DocumentContentResponse {
  success: boolean
  data?: { content?: string }
}

interface CreateWorklogResponse {
  success: boolean
  data?: { uuid: string, existed?: boolean }
}

interface CreateWeeklyReportResponse {
  success: boolean
  data?: { uuid: string, existed?: boolean }
}

interface DeletedWorklogMarker {
  uuid?: string
  date?: string | null
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = error.data
    if (typeof data === 'object' && data !== null && 'message' in data) {
      const message = data.message
      if (typeof message === 'string' && message) return message
    }
  }
  return fallback
}

// ==================== 基础状态 ====================

const toast = useToast()
const { user, userRealname } = useAuth()
const { setPayload: setDocumentPreviewBootstrap } = useDocumentPreviewBootstrap()
const uid = computed(() => user.value || 'user1')
const { panelWidth, panelCollapsed, onResizeStart, showPanel } = useResizablePanel(288)

// 模式切换：日志 / 周报
type JournalMode = 'worklog' | 'weekly'
const mode = ref<JournalMode>('worklog')

// 当前日历显示的年月
const calendarYear = ref(new Date().getFullYear())
const calendarMonth = ref(new Date().getMonth() + 1)

// ==================== 日志相关 ====================

const selectedDate = ref('')
const logDates = ref<Set<string>>(new Set())
const logUuidDateMap = ref<Map<string, string>>(new Map())
const monthLogs = ref<WorklogListItem[]>([])
const selectedLog = ref<{ uuid: string, title: string, readonly_flag?: number } | null>(null)

// ==================== 周报相关 ====================

const selectedWeek = ref<number | null>(null)
const selectedWeekYear = ref<number>(new Date().getFullYear())
const reportWeeks = ref<Map<string, WeeklyReportItem>>(new Map())
const selectedReport = ref<{ uuid: string, title: string, readonly_flag?: number } | null>(null)

// ==================== 共享状态 ====================

const previewContent = ref('')
const previewLoading = ref(false)
const isCreating = ref(false)
const monthLogsLoading = ref(false)

// 上报
const isSubmitting = ref(false)
const showSubmitConfirm = ref(false)
const isReported = computed(() => {
  if (mode.value === 'worklog') return !!selectedLog.value?.readonly_flag
  return !!selectedReport.value?.readonly_flag
})

// ==================== 工具函数 ====================

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isFutureDate(date: Date): boolean {
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return target.getTime() > today.getTime()
}

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function getISOWeekYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  return d.getUTCFullYear()
}

function toDateKey(dateStr: string): string {
  return dateStr.replace(/-/g, '')
}

const currentWeekNumber = computed(() => getISOWeekNumber(new Date()))
const currentWeekYear = computed(() => getISOWeekYear(new Date()))

// ==================== 日历数据 ====================

const monthLabel = computed(() => `${calendarYear.value}年${calendarMonth.value}月`)

const calendarWeeks = computed(() => {
  const year = calendarYear.value
  const month = calendarMonth.value - 1
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startWeekDay = firstDay.getDay() || 7

  const calStart = new Date(firstDay)
  calStart.setDate(firstDay.getDate() - (startWeekDay - 1))
  const endWeekDay = lastDay.getDay() || 7
  const calEnd = new Date(lastDay)
  calEnd.setDate(lastDay.getDate() + (7 - endWeekDay))
  const today = formatDate(new Date())

  const weeks: {
    weekNum: number
    weekYear: number
    isCurrent: boolean
    hasLog: boolean
    hasReport: boolean
    days: { date: string, day: number, isCurrentMonth: boolean, isToday: boolean, isFuture: boolean, hasLog: boolean }[]
  }[] = []

  const cursor = new Date(calStart)
  while (cursor <= calEnd) {
    const weekYear = getISOWeekYear(cursor)
    const weekNum = getISOWeekNumber(cursor)
    const days: typeof weeks[number]['days'] = []

    for (let i = 0; i < 7; i++) {
      const d = new Date(cursor)
      const dateStr = formatDate(d)
      days.push({
        date: dateStr,
        day: d.getDate(),
        isCurrentMonth: d.getMonth() === month && d.getFullYear() === year,
        isToday: dateStr === today,
        isFuture: isFutureDate(d),
        hasLog: logDates.value.has(dateStr)
      })
      cursor.setDate(cursor.getDate() + 1)
    }

    const reportKey = `${weekYear}-${weekNum}`
    weeks.push({
      weekNum,
      weekYear,
      isCurrent: weekNum === currentWeekNumber.value && weekYear === currentWeekYear.value,
      hasLog: days.some(day => day.hasLog),
      hasReport: reportWeeks.value.has(reportKey),
      days
    })
  }

  return weeks
})

// ==================== 日历导航 ====================

const prevMonth = () => {
  if (calendarMonth.value === 1) {
    calendarMonth.value = 12
    calendarYear.value--
  } else {
    calendarMonth.value--
  }
}

const nextMonth = () => {
  if (calendarMonth.value === 12) {
    calendarMonth.value = 1
    calendarYear.value++
  } else {
    calendarMonth.value++
  }
}

const goToday = () => {
  const today = new Date()
  calendarYear.value = today.getFullYear()
  calendarMonth.value = today.getMonth() + 1
  if (mode.value === 'worklog') {
    selectedDate.value = formatDate(today)
    checkSelectedDate()
  } else {
    selectedWeekYear.value = currentWeekYear.value
    selectedWeek.value = currentWeekNumber.value
    checkSelectedWeek()
  }
}

// ==================== 日志逻辑 ====================

const applyMonthLogs = (items: WorklogListItem[] = []) => {
  const dates = new Set<string>()
  const uuidMap = new Map<string, string>()
  items.forEach((item) => {
    if (item.date) {
      dates.add(item.date)
      uuidMap.set(item.uuid, item.date)
    }
  })
  logDates.value = dates
  logUuidDateMap.value = uuidMap
  monthLogs.value = [...items].sort((a, b) => a.date.localeCompare(b.date))
}

const clearWorklogStateByDate = (date: string) => {
  if (!date) return
  const nextDates = new Set(logDates.value)
  nextDates.delete(date)
  logDates.value = nextDates

  const nextUuidMap = new Map(logUuidDateMap.value)
  for (const [uuid, logDate] of nextUuidMap.entries()) {
    if (logDate === date) nextUuidMap.delete(uuid)
  }
  logUuidDateMap.value = nextUuidMap
  monthLogs.value = monthLogs.value.filter(item => item.date !== date)
  if (selectedDate.value === date) {
    selectedLog.value = null
    previewContent.value = ''
  }
}

const consumeDeletedWorklogMarker = () => {
  if (!import.meta.client) return
  const rawMarker = sessionStorage.getItem('worklog_deleted')
  if (!rawMarker) return
  sessionStorage.removeItem('worklog_deleted')
  let marker: DeletedWorklogMarker = {}
  try {
    marker = JSON.parse(rawMarker) as DeletedWorklogMarker
  } catch {
    marker = { uuid: rawMarker }
  }
  if (marker.date) {
    clearWorklogStateByDate(marker.date)
    return
  }
  if (marker.uuid) {
    const deletedDate = logUuidDateMap.value.get(marker.uuid)
    if (deletedDate) clearWorklogStateByDate(deletedDate)
  }
}

const fetchMonthLogs = async () => {
  if (!uid.value) return
  monthLogsLoading.value = true
  try {
    const res = await $fetch<WorklogListResponse>('/api/worklogs/list', {
      query: { owner: uid.value, year: calendarYear.value, month: calendarMonth.value }
    })
    applyMonthLogs(res.success ? (res.data?.items || []) : [])
  } catch {
    applyMonthLogs()
  } finally {
    monthLogsLoading.value = false
  }
}

const selectedDateLabel = computed(() => {
  if (!selectedDate.value) return ''
  const [y, m, d] = selectedDate.value.split('-')
  const weekDays = ['日', '一', '二', '三', '四', '五', '六']
  const weekDay = weekDays[new Date(selectedDate.value).getDay()]
  return `${y}年${m}月${d}日 星期${weekDay}`
})

const canCreateLog = computed(() => {
  if (!selectedDate.value) return false
  return selectedDate.value <= formatDate(new Date())
})

const selectDay = (dateStr: string) => {
  selectedDate.value = dateStr
  checkSelectedDate()
}

const checkSelectedDate = async () => {
  if (!selectedDate.value || !uid.value) return
  selectedLog.value = null
  previewContent.value = ''
  if (logDates.value.has(selectedDate.value)) await loadLog()
}

const loadLog = async () => {
  previewLoading.value = true
  try {
    const res = await $fetch<WorklogListResponse>('/api/worklogs/list', {
      query: { owner: uid.value, year: calendarYear.value, month: calendarMonth.value }
    })
    applyMonthLogs(res.success ? (res.data?.items || []) : [])
    const item = res.data?.items?.find(i => i.date === selectedDate.value)
    if (item) {
      const docRes = await $fetch<DocumentContentResponse>(`/api/documents/${item.uuid}`, { params: { uid: uid.value } })
      if (docRes.success && docRes.data) {
        previewContent.value = docRes.data.content || ''
        selectedLog.value = { uuid: item.uuid, title: item.title, readonly_flag: (docRes.data as Record<string, unknown>).readonly_flag as number | undefined }
      } else {
        selectedLog.value = { uuid: item.uuid, title: item.title }
      }
    } else {
      clearWorklogStateByDate(selectedDate.value)
    }
  } catch {
    toast.add({ title: '加载日志失败', color: 'error' })
  } finally {
    previewLoading.value = false
  }
}

const createLog = async () => {
  if (!selectedDate.value || !uid.value) return
  isCreating.value = true
  try {
    const dateKey = toDateKey(selectedDate.value)
    const res = await $fetch<CreateWorklogResponse>('/api/worklogs/create', {
      method: 'POST',
      body: { owner_uid: uid.value, owner_realname: userRealname.value || '', date: dateKey }
    })
    if (res.success && res.data) {
      await fetchMonthLogs()
      const query = res.data.existed ? {} : { new: '1' }
      navigateTo({ path: `/documents/${res.data.uuid}`, query })
    }
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '创建日志失败'), color: 'error' })
  } finally {
    isCreating.value = false
  }
}

const editLog = () => {
  if (selectedLog.value) {
    if (previewContent.value) {
      setDocumentPreviewBootstrap(selectedLog.value.uuid, {
        content: previewContent.value
      })
    }
    navigateTo(`/documents/${selectedLog.value.uuid}`)
  }
}

// ==================== 周报逻辑 ====================

const fetchReports = async () => {
  if (!uid.value) return
  const yearsToFetch = new Set<number>()
  yearsToFetch.add(calendarYear.value)
  if (calendarMonth.value === 1) yearsToFetch.add(calendarYear.value - 1)
  if (calendarMonth.value === 12) yearsToFetch.add(calendarYear.value + 1)

  const weekMap = new Map<string, WeeklyReportItem>()
  for (const [key, val] of reportWeeks.value) {
    const keyYear = parseInt(key.split('-')[0]!)
    if (!yearsToFetch.has(keyYear)) weekMap.set(key, val)
  }

  for (const yr of yearsToFetch) {
    try {
      const res = await $fetch<WeeklyReportListResponse>('/api/personal-weekly-reports/list', {
        query: { owner: uid.value, year: yr }
      })
      if (res.success && res.data?.items) {
        res.data.items.forEach((item) => {
          if (item.week > 0) weekMap.set(`${item.year}-${item.week}`, item)
        })
      }
    } catch { /* 静默 */ }
  }
  reportWeeks.value = weekMap
}

const isWeekSelected = (weekYear: number, weekNum: number) => {
  return selectedWeekYear.value === weekYear && selectedWeek.value === weekNum
}

const selectedWeekLabel = computed(() => {
  if (selectedWeek.value === null) return ''
  const weekStr = String(selectedWeek.value).padStart(2, '0')
  const jan4 = new Date(selectedWeekYear.value, 0, 4)
  const dayOfWeek = jan4.getDay() || 7
  const week1Monday = new Date(jan4)
  week1Monday.setDate(jan4.getDate() - dayOfWeek + 1)
  const targetMonday = new Date(week1Monday)
  targetMonday.setDate(week1Monday.getDate() + (selectedWeek.value - 1) * 7)
  const targetSunday = new Date(targetMonday)
  targetSunday.setDate(targetMonday.getDate() + 6)
  const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
  return `${selectedWeekYear.value}年 第${weekStr}周（${fmt(targetMonday)} ~ ${fmt(targetSunday)}）`
})

const canCreateReport = computed(() => {
  if (selectedWeek.value === null) return false
  const thisYear = currentWeekYear.value
  const thisWeek = currentWeekNumber.value
  if (selectedWeekYear.value < thisYear) return true
  if (selectedWeekYear.value > thisYear) return false
  return selectedWeek.value <= thisWeek
})

const selectWeek = (weekYear: number, weekNum: number) => {
  selectedWeekYear.value = weekYear
  selectedWeek.value = weekNum
  checkSelectedWeek()
}

const checkSelectedWeek = async () => {
  if (selectedWeek.value === null) return
  selectedReport.value = null
  previewContent.value = ''
  const reportKey = `${selectedWeekYear.value}-${selectedWeek.value}`
  const report = reportWeeks.value.get(reportKey)
  if (report) await loadReport(report)
}

const loadReport = async (report: WeeklyReportItem) => {
  previewLoading.value = true
  try {
    const docRes = await $fetch<DocumentContentResponse>(`/api/documents/${report.uuid}`, { params: { uid: uid.value } })
    if (docRes.success && docRes.data) {
      previewContent.value = docRes.data.content || ''
      selectedReport.value = { uuid: report.uuid, title: report.title, readonly_flag: (docRes.data as Record<string, unknown>).readonly_flag as number | undefined }
    } else {
      selectedReport.value = { uuid: report.uuid, title: report.title }
    }
  } catch {
    toast.add({ title: '加载周报失败', color: 'error' })
  } finally {
    previewLoading.value = false
  }
}

const createReport = async () => {
  if (selectedWeek.value === null || !uid.value) return
  isCreating.value = true
  try {
    const res = await $fetch<CreateWeeklyReportResponse>('/api/personal-weekly-reports/create', {
      method: 'POST',
      body: { owner_uid: uid.value, owner_realname: userRealname.value || '', year: selectedWeekYear.value, week: selectedWeek.value }
    })
    if (res.success && res.data) {
      await fetchReports()
      navigateTo(`/documents/${res.data.uuid}`)
    }
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '创建周报失败'), color: 'error' })
  } finally {
    isCreating.value = false
  }
}

const editReport = () => {
  if (selectedReport.value) {
    if (previewContent.value) {
      setDocumentPreviewBootstrap(selectedReport.value.uuid, {
        content: previewContent.value
      })
    }
    navigateTo(`/documents/${selectedReport.value.uuid}`)
  }
}

// ==================== 上报 ====================

const submitCurrent = async () => {
  const target = mode.value === 'worklog' ? selectedLog.value : selectedReport.value
  if (!target) return
  isSubmitting.value = true
  try {
    await $fetch(`/api/documents/${target.uuid}`, { method: 'PATCH', body: { readonly_flag: true } })
    target.readonly_flag = 1
    showSubmitConfirm.value = false
    toast.add({ title: `上报成功，${mode.value === 'worklog' ? '日志' : '周报'}已设为只读`, color: 'success' })
  } catch {
    toast.add({ title: '上报失败', color: 'error' })
  } finally {
    isSubmitting.value = false
  }
}

const currentTitle = computed(() => {
  if (mode.value === 'worklog') return selectedLog.value?.title
  return selectedReport.value?.title
})

// ==================== 模式切换 ====================

const switchMode = (newMode: JournalMode) => {
  if (mode.value === newMode) return
  mode.value = newMode
  // 清空另一模式的选中态
  previewContent.value = ''
  if (newMode === 'worklog') {
    selectedReport.value = null
    if (selectedDate.value) checkSelectedDate()
  } else {
    selectedLog.value = null
    if (selectedWeek.value !== null) checkSelectedWeek()
  }
}

// ==================== 月份变化时刷新 ====================

watch([calendarYear, calendarMonth], () => {
  fetchMonthLogs()
  fetchReports()
})

// ==================== 初始化 ====================

onMounted(async () => {
  const today = new Date()
  selectedDate.value = formatDate(today)
  selectedWeekYear.value = currentWeekYear.value
  selectedWeek.value = currentWeekNumber.value

  await Promise.all([fetchMonthLogs(), fetchReports()])
  consumeDeletedWorklogMarker()
  checkSelectedDate()
})
</script>

<template>
  <UDashboardPanel grow>
    <div v-if="panelCollapsed" class="flex justify-end gap-2 px-4 py-2 border-b border-default">
      <UButton
        class="hidden md:flex"
        icon="i-lucide-folder-tree"
        variant="ghost"
        size="sm"
        @click="showPanel"
      >
        日历
      </UButton>
    </div>

    <div class="flex flex-1 overflow-hidden">
      <!-- 左侧：日历 -->
      <aside
        v-if="!panelCollapsed"
        class="relative border-r border-default bg-default flex-col p-4 overflow-y-auto hidden md:flex"
        :style="{ width: panelWidth + 'px' }"
      >
        <!-- 页签切换 -->
        <div class="flex rounded-lg border border-default bg-elevated p-0.5 mb-4">
          <button
            class="hover:text-default flex-1 text-center text-sm py-1.5 rounded-md transition-colors font-medium"
            :class="mode === 'worklog'
              ? 'bg-white dark:bg-gray-700 text-primary shadow-sm'
              : 'text-muted hover:text-default'"
            variant="outline"
            @click="switchMode('worklog')"
          >
            工作日志
          </button>
          <button
            class="flex-1 text-center text-sm py-1.5 rounded-md transition-colors font-medium"
            :class="mode === 'weekly'
              ? 'bg-white dark:bg-gray-700 text-primary shadow-sm'
              : 'text-muted hover:text-default'"
            color="mode === 'weekly' ? 'primary' : 'neutral'"
            variant="outline"
            @click="switchMode('weekly')"
          >
            工作周报
          </button>
        </div>

        <div class="rounded-lg border border-default bg-elevated p-3">
          <!-- 月份导航 -->
          <div class="flex items-center justify-between mb-3">
            <UButton
              icon="i-lucide-chevron-left"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="prevMonth"
            />
            <span class="text-sm font-semibold">{{ monthLabel }}</span>
            <UButton
              icon="i-lucide-chevron-right"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="nextMonth"
            />
          </div>

          <!-- 今天/本周按钮 -->
          <div class="flex justify-center mb-3">
            <UButton
              variant="soft"
              color="primary"
              size="xs"
              @click="goToday"
            >
              {{ mode === 'worklog' ? '今天' : '本周' }}
            </UButton>
          </div>

          <!-- 星期标题 -->
          <div class="grid grid-cols-8 text-center text-xs text-muted mb-1">
            <span class="font-medium">W</span>
            <span v-for="w in ['一', '二', '三', '四', '五', '六', '日']" :key="w">{{ w }}</span>
          </div>

          <!-- 日历网格 -->
          <div class="space-y-1">
            <div
              v-for="weekRow in calendarWeeks"
              :key="`${weekRow.weekYear}-${weekRow.weekNum}`"
              class="grid grid-cols-8 gap-1"
              :class="{ 'items-center': mode === 'weekly' }"
            >
              <!-- 周号 -->
              <div
                class="flex items-center justify-center text-[10px] font-semibold"
                :class="{
                  'text-primary': weekRow.isCurrent,
                  'text-green-600 dark:text-green-400': (mode === 'worklog' ? weekRow.hasLog : weekRow.hasReport) && !weekRow.isCurrent,
                  'text-muted': !weekRow.isCurrent && !(mode === 'worklog' ? weekRow.hasLog : weekRow.hasReport)
                }"
              >
                {{ weekRow.weekNum }}
              </div>

              <!-- 日志模式：每天可点 -->
              <template v-if="mode === 'worklog'">
                <button
                  v-for="day in weekRow.days"
                  :key="day.date"
                  class="relative w-full aspect-square flex items-center justify-center text-xs rounded-md border border-default bg-default transition-colors"
                  :class="{
                    'text-muted bg-elevated': ((!day.isCurrentMonth) || (day.isCurrentMonth && day.isFuture && !day.isToday && !day.hasLog)) && selectedDate !== day.date,
                    'text-default': day.isCurrentMonth && !day.isFuture && !day.isToday && !day.hasLog,
                    'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800': day.hasLog && !day.isToday && selectedDate !== day.date,
                    'bg-primary/10 text-primary font-semibold border-primary': day.isToday && selectedDate !== day.date,
                    'ring-2 ring-primary bg-primary/12 text-primary font-semibold border-primary': selectedDate === day.date && !day.isFuture,
                    'ring-2 ring-gray-500 bg-gray-100 text-gray-800 font-semibold border-gray-300 dark:ring-gray-400 dark:bg-gray-900/70 dark:text-gray-100 dark:border-gray-700': selectedDate === day.date && day.isFuture,
                    'hover:bg-gray-100 dark:hover:bg-gray-800': day.isCurrentMonth && !day.isFuture && !day.hasLog,
                    'hover:bg-gray-50 dark:hover:bg-gray-900/60': day.isCurrentMonth && day.isFuture && !day.hasLog && selectedDate !== day.date
                  }"
                  @click="selectDay(day.date)"
                >
                  {{ day.day }}
                  <span
                    v-if="day.hasLog"
                    class="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary"
                    :class="{ 'bg-white': day.isToday && selectedDate !== day.date }"
                  />
                </button>
              </template>

              <!-- 周报模式：整行可点 -->
              <button
                v-else
                class="col-span-7 grid grid-cols-7 text-center text-xs rounded-md border border-default bg-default transition-colors py-1.5"
                :class="{
                  'ring-2 ring-primary bg-primary/10 font-semibold border-primary': isWeekSelected(weekRow.weekYear, weekRow.weekNum) && !weekRow.days.every(day => day.isFuture),
                  'ring-2 ring-gray-500 bg-gray-100 text-gray-800 font-semibold border-gray-300 dark:ring-gray-400 dark:bg-gray-900/70 dark:text-gray-100 dark:border-gray-700': isWeekSelected(weekRow.weekYear, weekRow.weekNum) && weekRow.days.every(day => day.isFuture),
                  'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800': weekRow.hasReport && !isWeekSelected(weekRow.weekYear, weekRow.weekNum),
                  'hover:bg-gray-100 dark:hover:bg-gray-800': !isWeekSelected(weekRow.weekYear, weekRow.weekNum)
                }"
                @click="selectWeek(weekRow.weekYear, weekRow.weekNum)"
              >
                <span
                  v-for="day in weekRow.days"
                  :key="day.date"
                  class="flex items-center justify-center"
                  :class="{
                    'text-muted': !day.isCurrentMonth || (day.isCurrentMonth && day.isFuture && !day.isToday),
                    'text-default': day.isCurrentMonth && !day.isFuture && !day.isToday,
                    'bg-primary/10 text-primary rounded-full w-5 h-5 mx-auto font-semibold': day.isToday
                  }"
                >
                  {{ day.day }}
                </span>
              </button>
            </div>
          </div>

          <!-- 统计 -->
          <div class="mt-4 pt-3 border-t border-default text-xs text-muted text-center">
            <template v-if="mode === 'worklog'">
              本月已记录 {{ logDates.size }} 天
            </template>
            <template v-else>
              已创建 {{ reportWeeks.size }} 份周报
            </template>
          </div>
        </div>

        <!-- 日志列表（仅日志模式） -->
        <div v-if="mode === 'worklog' && monthLogs.length > 0" class="mt-4 pt-3 border-t border-default">
          <h4 class="text-xs font-semibold text-muted mb-2">
            当月工作日志
          </h4>
          <div class="space-y-1">
            <button
              v-for="item in monthLogs"
              :key="item.uuid"
              class="w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors flex items-center gap-1.5"
              :class="selectedLog?.uuid === item.uuid
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-default hover:bg-gray-100 dark:hover:bg-gray-800'"
              @click="selectDay(item.date)"
            >
              <UIcon name="i-lucide-file-text" class="w-3.5 h-3.5 shrink-0 text-primary" />
              <span class="shrink-0 text-muted tabular-nums">{{ item.date.slice(5) }}</span>
              <span class="truncate">{{ item.title }}</span>
            </button>
          </div>
        </div>
        <div v-else-if="mode === 'worklog' && monthLogsLoading" class="mt-4 pt-3 border-t border-default text-center">
          <UIcon name="i-lucide-loader-2" class="w-4 h-4 animate-spin text-muted" />
        </div>
      </aside>

      <!-- 拖拽把手 -->
      <div
        v-if="!panelCollapsed"
        class="hidden md:block w-1.5 shrink-0 cursor-col-resize bg-default hover:bg-primary/40 active:bg-primary/60 transition-colors z-10 -ml-px"
        @mousedown.prevent="onResizeStart"
      />

      <!-- 右侧：内容 -->
      <main class="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
        <!-- 移动端月份选择 -->
        <div class="md:hidden flex items-center justify-between px-4 py-2 border-b border-default bg-default">
          <UButton
            icon="i-lucide-chevron-left"
            variant="ghost"
            color="neutral"
            size="xs"
            @click="prevMonth"
          />
          <span class="text-sm font-semibold">{{ monthLabel }}</span>
          <UButton
            icon="i-lucide-chevron-right"
            variant="ghost"
            color="neutral"
            size="xs"
            @click="nextMonth"
          />
        </div>

        <div class="flex-1 overflow-auto p-4">
          <!-- ===== 日志模式 ===== -->
          <template v-if="mode === 'worklog'">
            <div v-if="!selectedDate" class="h-full flex items-center justify-center">
              <div class="text-center text-muted">
                <UIcon name="i-lucide-calendar" class="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>请在左侧日历中选择日期</p>
              </div>
            </div>

            <div v-else-if="previewLoading" class="h-full flex items-center justify-center">
              <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
            </div>

            <div v-else-if="selectedLog" class="max-w-4xl mx-auto">
              <div class="flex items-center justify-between mb-4">
                <h2 class="text-lg font-semibold text-default">
                  {{ selectedDateLabel }}
                  <span v-if="isReported" class="ml-2 text-xs font-normal text-green-600 bg-green-50 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded">已上报</span>
                </h2>
                <div class="flex items-center gap-2">
                  <UButton
                    v-if="!isReported"
                    icon="i-lucide-send"
                    size="sm"
                    color="neutral"
                    variant="outline"
                    @click="showSubmitConfirm = true"
                  >
                    上报
                  </UButton>
                  <UButton
                    :icon="isReported ? 'i-lucide-eye' : 'i-lucide-edit'"
                    size="sm"
                    color="primary"
                    @click="editLog"
                  >
                    {{ isReported ? '查看' : '编辑日志' }}
                  </UButton>
                </div>
              </div>
              <div class="bg-white dark:bg-gray-900 shadow-sm rounded-lg min-h-75 p-0">
                <EditorDocLazyPreview v-if="previewContent" :content="previewContent" />
              </div>
            </div>

            <div v-else class="h-full flex items-center justify-center">
              <div class="text-center">
                <UIcon name="i-lucide-notebook-pen" class="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                <h3 class="text-lg font-semibold text-default mb-2">
                  {{ selectedDateLabel }}
                </h3>
                <p class="text-sm text-muted mb-6">
                  当前日期没有工作日志
                </p>
                <UButton
                  v-if="canCreateLog"
                  icon="i-lucide-plus"
                  color="primary"
                  :loading="isCreating"
                  @click="createLog"
                >
                  创建日志
                </UButton>
                <p v-else class="text-xs text-muted">
                  不能为未来日期创建日志
                </p>
              </div>
            </div>
          </template>

          <!-- ===== 周报模式 ===== -->
          <template v-else>
            <div v-if="selectedWeek === null" class="h-full flex items-center justify-center">
              <div class="text-center text-muted">
                <UIcon name="i-lucide-calendar-range" class="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>请在左侧日历中选择一周</p>
              </div>
            </div>

            <div v-else-if="previewLoading" class="h-full flex items-center justify-center">
              <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
            </div>

            <div v-else-if="selectedReport" class="max-w-4xl mx-auto">
              <div class="flex items-center justify-between mb-4">
                <h2 class="text-lg font-semibold text-default">
                  {{ selectedWeekLabel }}
                  <span v-if="isReported" class="ml-2 text-xs font-normal text-green-600 bg-green-50 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded">已上报</span>
                </h2>
                <div class="flex items-center gap-2">
                  <UButton
                    v-if="!isReported"
                    icon="i-lucide-send"
                    size="sm"
                    color="neutral"
                    variant="outline"
                    @click="showSubmitConfirm = true"
                  >
                    上报
                  </UButton>
                  <UButton
                    :icon="isReported ? 'i-lucide-eye' : 'i-lucide-edit'"
                    size="sm"
                    color="primary"
                    @click="editReport"
                  >
                    {{ isReported ? '查看' : '编辑周报' }}
                  </UButton>
                </div>
              </div>
              <div class="bg-white dark:bg-gray-900 shadow-sm rounded-lg min-h-75 p-0">
                <EditorDocLazyPreview v-if="previewContent" :content="previewContent" />
              </div>
            </div>

            <div v-else class="h-full flex items-center justify-center">
              <div class="text-center">
                <UIcon name="i-lucide-file-text" class="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                <h3 class="text-lg font-semibold text-default mb-2">
                  {{ selectedWeekLabel }}
                </h3>
                <p class="text-sm text-muted mb-6">
                  尚未创建该周的工作周报
                </p>
                <UButton
                  v-if="canCreateReport"
                  icon="i-lucide-plus"
                  color="primary"
                  :loading="isCreating"
                  @click="createReport"
                >
                  创建周报
                </UButton>
                <p v-else class="text-xs text-muted">
                  不能为未来的周创建周报
                </p>
              </div>
            </div>
          </template>
        </div>
      </main>
    </div>

    <!-- 上报确认弹窗 -->
    <UModal v-model:open="showSubmitConfirm">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-alert-triangle" class="w-5 h-5 text-amber-500" />
              <h3 class="text-lg font-semibold">
                确认上报
              </h3>
            </div>
          </template>

          <p class="text-muted">
            确定要上报{{ mode === 'worklog' ? '工作日志' : '工作周报' }}
            <strong class="text-default">"{{ currentTitle }}"</strong> 吗？
          </p>
          <p class="text-sm text-amber-600 dark:text-amber-400 mt-2">
            上报后将设为只读，不可再修改。
          </p>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="outline" @click="showSubmitConfirm = false">
                取消
              </UButton>
              <UButton color="primary" :loading="isSubmitting" @click="submitCurrent">
                确认上报
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
