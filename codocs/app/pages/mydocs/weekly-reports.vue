<script setup lang="ts">
/**
 * 个人工作周报页面
 * 左侧日历（按周选择），右侧查看/编辑周报
 * 参照部门周报，简化为个人使用（无部门选择）
 */

definePageMeta({ layout: 'default' })

usePageTitle('工作周报')

interface WeeklyReportItem {
  uuid: string
  title: string
  year: number
  week: number
}

interface WeeklyReportListResponse {
  success: boolean
  data?: {
    items: WeeklyReportItem[]
  }
}

interface DocumentContentResponse {
  success: boolean
  data?: {
    content?: string
  }
}

interface CreateWeeklyReportResponse {
  success: boolean
  data?: {
    uuid: string
    existed?: boolean
  }
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = error.data
    if (typeof data === 'object' && data !== null && 'message' in data) {
      const message = data.message
      if (typeof message === 'string' && message) {
        return message
      }
    }
  }
  return fallback
}

const toast = useToast()
const { user, userRealname, userDeptCode } = useAuth()
const { setPayload: setDocumentPreviewBootstrap } = useDocumentPreviewBootstrap()
const uid = computed(() => user.value || 'user1')
const { panelWidth, panelCollapsed, onResizeStart, showPanel } = useResizablePanel(320)

// ==================== 日历相关 ====================

const calendarYear = ref(new Date().getFullYear())
const calendarMonth = ref(new Date().getMonth() + 1)

const selectedWeek = ref<number | null>(null)
const selectedWeekYear = ref<number>(new Date().getFullYear())

const reportWeeks = ref<Map<string, WeeklyReportItem>>(new Map())

const selectedReport = ref<{ uuid: string, title: string, readonly_flag?: number } | null>(null)
const previewContent = ref('')
const previewLoading = ref(false)
const isCreating = ref(false)

// 上报相关
const isSubmitting = ref(false)
const showSubmitConfirm = ref(false)
const isReported = computed(() => !!selectedReport.value?.readonly_flag)

const submitReport = async () => {
  if (!selectedReport.value) return
  isSubmitting.value = true
  try {
    await $fetch(`/api/documents/${selectedReport.value.uuid}`, {
      method: 'PATCH',
      body: {
        readonly_flag: true,
        dept_code: userDeptCode.value || undefined
      }
    })
    selectedReport.value.readonly_flag = 1
    showSubmitConfirm.value = false
    toast.add({ title: '上报成功，周报已设为只读', color: 'success' })
  } catch {
    toast.add({ title: '上报失败', color: 'error' })
  } finally {
    isSubmitting.value = false
  }
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

const currentWeekNumber = computed(() => getISOWeekNumber(new Date()))
const currentWeekYear = computed(() => getISOWeekYear(new Date()))

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

interface CalendarWeekRow {
  weekYear: number
  weekNum: number
  days: {
    date: string
    day: number
    isCurrentMonth: boolean
    isToday: boolean
    isFuture: boolean
  }[]
  hasReport: boolean
  isCurrent: boolean
}

const calendarWeeks = computed<CalendarWeekRow[]>(() => {
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
  const weeks: CalendarWeekRow[] = []

  const cursor = new Date(calStart)
  while (cursor <= calEnd) {
    const weekYear = getISOWeekYear(cursor)
    const weekNum = getISOWeekNumber(cursor)
    const days: CalendarWeekRow['days'] = []

    for (let i = 0; i < 7; i++) {
      const d = new Date(cursor)
      const dateStr = formatDate(d)
      days.push({
        date: dateStr,
        day: d.getDate(),
        isCurrentMonth: d.getMonth() === month && d.getFullYear() === year,
        isToday: dateStr === today,
        isFuture: isFutureDate(d)
      })
      cursor.setDate(cursor.getDate() + 1)
    }

    const reportKey = `${weekYear}-${weekNum}`
    weeks.push({
      weekYear,
      weekNum,
      days,
      hasReport: reportWeeks.value.has(reportKey),
      isCurrent: weekYear === currentWeekYear.value && weekNum === currentWeekNumber.value
    })
  }

  return weeks
})

const monthLabel = computed(() => `${calendarYear.value}年${calendarMonth.value}月`)

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

const goThisWeek = () => {
  const now = new Date()
  calendarYear.value = now.getFullYear()
  calendarMonth.value = now.getMonth() + 1
  selectedWeekYear.value = currentWeekYear.value
  selectedWeek.value = currentWeekNumber.value
  checkSelectedWeek()
}

const fetchReports = async () => {
  if (!uid.value) return

  const yearsToFetch = new Set<number>()
  yearsToFetch.add(calendarYear.value)
  if (calendarMonth.value === 1) yearsToFetch.add(calendarYear.value - 1)
  if (calendarMonth.value === 12) yearsToFetch.add(calendarYear.value + 1)

  const weekMap = new Map<string, WeeklyReportItem>()

  for (const [key, val] of reportWeeks.value) {
    const keyYear = parseInt(key.split('-')[0]!)
    if (!yearsToFetch.has(keyYear)) {
      weekMap.set(key, val)
    }
  }

  for (const yr of yearsToFetch) {
    try {
      const res = await $fetch<WeeklyReportListResponse>('/api/personal-weekly-reports/list', {
        query: { owner: uid.value, year: yr }
      })
      if (res.success && res.data?.items) {
        res.data.items.forEach((item) => {
          if (item.week > 0) {
            weekMap.set(`${item.year}-${item.week}`, item)
          }
        })
      }
    } catch {
      // 静默
    }
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

const canCreate = computed(() => {
  if (selectedWeek.value === null) return false
  const now = new Date()
  const thisYear = getISOWeekYear(now)
  const thisWeek = getISOWeekNumber(now)
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
  if (report) {
    await loadReport(report)
  }
}

const loadReport = async (report: WeeklyReportItem) => {
  previewLoading.value = true
  try {
    const docRes = await $fetch<DocumentContentResponse>(`/api/documents/${report.uuid}`, {
      params: { uid: uid.value }
    })
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
      body: {
        owner_uid: uid.value,
        owner_realname: userRealname.value || '',
        year: selectedWeekYear.value,
        week: selectedWeek.value
      }
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

// 初始加载
onMounted(async () => {
  selectedWeekYear.value = currentWeekYear.value
  selectedWeek.value = currentWeekNumber.value
  await fetchReports()
  checkSelectedWeek()
})

watch([calendarYear, calendarMonth], () => {
  fetchReports()
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
        目录
      </UButton>
    </div>

    <div class="flex flex-1 overflow-hidden">
      <!-- 左侧：日历按周选择 -->
      <aside
        v-if="!panelCollapsed"
        class="relative border-r border-default bg-default flex-col p-4 overflow-y-auto hidden md:flex shrink-0"
        :style="{ width: panelWidth + 'px', minWidth: '280px' }"
      >
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

          <!-- 本周按钮 -->
          <div class="flex justify-center mb-3">
            <UButton
              variant="soft"
              color="primary"
              size="xs"
              @click="goThisWeek"
            >
              本周
            </UButton>
          </div>

          <!-- 星期标题行 -->
          <div class="grid grid-cols-8 text-center text-xs text-muted mb-1">
            <span class="font-medium">W</span>
            <span v-for="w in ['一', '二', '三', '四', '五', '六', '日']" :key="w">{{ w }}</span>
          </div>

          <!-- 日历网格：每行是一个可选周 -->
          <div class="space-y-1">
            <div
              v-for="weekRow in calendarWeeks"
              :key="`${weekRow.weekYear}-${weekRow.weekNum}`"
              class="grid grid-cols-8 items-center gap-1"
            >
              <!-- 周号 -->
              <span
                class="flex items-center justify-center text-[10px] font-semibold"
                :class="{
                  'text-primary': weekRow.isCurrent,
                  'text-green-600 dark:text-green-400': weekRow.hasReport && !weekRow.isCurrent,
                  'text-muted': !weekRow.isCurrent && !weekRow.hasReport
                }"
              >
                {{ weekRow.weekNum }}
              </span>
              <!-- 日期格子 -->
              <button
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

          <!-- 图例 -->
          <div class="mt-4 pt-3 border-t border-default flex items-center justify-center gap-4 text-xs text-muted">
            <span class="flex items-center gap-1">
              <span class="w-2.5 h-2.5 rounded-sm bg-green-100 dark:bg-green-900/40 border border-green-300 dark:border-green-700" />
              已创建
            </span>
            <span class="flex items-center gap-1">
              <span class="w-2.5 h-2.5 rounded-full bg-primary" />
              今天
            </span>
          </div>

          <!-- 统计 -->
          <div class="mt-2 text-xs text-muted text-center">
            已创建 {{ reportWeeks.size }} 份周报
          </div>
        </div>
      </aside>
      <!-- 拖拽调整宽度把手 -->
      <div
        v-if="!panelCollapsed"
        class="hidden md:block w-1.5 shrink-0 cursor-col-resize bg-default hover:bg-primary/40 active:bg-primary/60 transition-colors z-10 -ml-px"
        @mousedown.prevent="onResizeStart"
      />

      <!-- 右侧：周报内容 -->
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
          <!-- 未选择周 -->
          <div v-if="selectedWeek === null" class="h-full flex items-center justify-center">
            <div class="text-center text-muted">
              <UIcon name="i-lucide-calendar-range" class="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>请在左侧日历中选择一周</p>
            </div>
          </div>

          <!-- 加载中 -->
          <div v-else-if="previewLoading" class="h-full flex items-center justify-center">
            <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
          </div>

          <!-- 有周报：预览 -->
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
              <EditorDocLazyPreview
                v-if="previewContent"
                :content="previewContent"
              />
            </div>
          </div>

          <!-- 无周报：提示创建 -->
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
                v-if="canCreate"
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
            确定要上报工作周报
            <strong class="text-default">"{{ selectedReport?.title }}"</strong> 吗？
          </p>
          <p class="text-sm text-amber-600 dark:text-amber-400 mt-2">
            上报后周报将设为只读，不可再修改。
          </p>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="outline" @click="showSubmitConfirm = false">
                取消
              </UButton>
              <UButton color="primary" :loading="isSubmitting" @click="submitReport">
                确认上报
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
