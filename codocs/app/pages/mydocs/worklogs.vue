<script setup lang="ts">
/**
 * 工作日志页面
 * 左侧日历选择日期，右侧查看/编辑日志
 */

definePageMeta({ layout: 'default' })

usePageTitle('工作日志')

interface WorklogListItem {
  uuid: string
  title: string
  date: string
}

interface WorklogListResponse {
  success: boolean
  data?: {
    items: WorklogListItem[]
  }
}

interface DocumentContentResponse {
  success: boolean
  data?: {
    content?: string
  }
}

interface CreateWorklogResponse {
  success: boolean
  data?: {
    uuid: string
    existed?: boolean
  }
}

interface DeletedWorklogMarker {
  uuid?: string
  date?: string | null
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
const { panelWidth, panelCollapsed, onResizeStart, showPanel } = useResizablePanel(288)

// 当前日历显示的年月
const calendarYear = ref(new Date().getFullYear())
const calendarMonth = ref(new Date().getMonth() + 1) // 1-based

// 选中的日期 YYYY-MM-DD
const selectedDate = ref('')

// 该月有日志的日期集合
const logDates = ref<Set<string>>(new Set())
// uuid -> date 映射（用于检测已删除的文档）
const logUuidDateMap = ref<Map<string, string>>(new Map())
// 当月日志列表
const monthLogs = ref<WorklogListItem[]>([])

// 选中日期的文档信息
const selectedLog = ref<{ uuid: string, title: string, readonly_flag?: number } | null>(null)

// 预览内容
const previewContent = ref('')
const previewLoading = ref(false)

// 创建中
const isCreating = ref(false)
const monthLogsLoading = ref(false)

// 上报中
const isSubmitting = ref(false)
const showSubmitConfirm = ref(false)

// 是否已上报（只读）
const isReported = computed(() => !!selectedLog.value?.readonly_flag)

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
    if (logDate === date) {
      nextUuidMap.delete(uuid)
    }
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
    if (deletedDate) {
      clearWorklogStateByDate(deletedDate)
    }
  }
}

// 上报日志
const submitLog = async () => {
  if (!selectedLog.value) return
  isSubmitting.value = true
  try {
    await $fetch(`/api/documents/${selectedLog.value.uuid}`, {
      method: 'PATCH',
      body: {
        readonly_flag: true,
        dept_code: userDeptCode.value || undefined
      }
    })
    selectedLog.value.readonly_flag = 1
    showSubmitConfirm.value = false
    toast.add({ title: '上报成功，日志已设为只读', color: 'success' })
  } catch {
    toast.add({ title: '上报失败', color: 'error' })
  } finally {
    isSubmitting.value = false
  }
}

// 获取该月日志列表
const fetchMonthLogs = async () => {
  if (!uid.value) return
  monthLogsLoading.value = true
  try {
    const res = await $fetch<WorklogListResponse>('/api/worklogs/list', {
      query: { owner: uid.value, year: calendarYear.value, month: calendarMonth.value }
    })
    applyMonthLogs(res.success ? (res.data?.items || []) : [])
  } catch {
    // 静默
    applyMonthLogs()
  } finally {
    monthLogsLoading.value = false
  }
}

// 初始加载
onMounted(async () => {
  await fetchMonthLogs()

  consumeDeletedWorklogMarker()

  // 默认选中今天
  const today = new Date()
  selectedDate.value = formatDate(today)
  checkSelectedDate()
})

// 月份切换时重新加载
watch([calendarYear, calendarMonth], () => {
  fetchMonthLogs()
})

// 格式化日期为 YYYY-MM-DD
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

// 格式化日期为 YYYYMMDD
function toDateKey(dateStr: string): string {
  return dateStr.replace(/-/g, '')
}

// 日历数据：生成当月的日期网格
const calendarWeeks = computed(() => {
  const year = calendarYear.value
  const month = calendarMonth.value - 1 // 0-based
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startWeekDay = firstDay.getDay() || 7

  const days: { date: string, day: number, isCurrentMonth: boolean, isToday: boolean, isFuture: boolean, hasLog: boolean }[] = []
  const calStart = new Date(firstDay)
  calStart.setDate(firstDay.getDate() - (startWeekDay - 1))
  const endWeekDay = lastDay.getDay() || 7
  const calEnd = new Date(lastDay)
  calEnd.setDate(lastDay.getDate() + (7 - endWeekDay))
  const today = formatDate(new Date())

  const cursor = new Date(calStart)
  while (cursor <= calEnd) {
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

  const now = new Date()
  const currentWeekNumber = getISOWeekNumber(now)
  const currentWeekYear = getISOWeekYear(now)

  return Array.from({ length: days.length / 7 }, (_, index) => {
    const weekDays = days.slice(index * 7, (index + 1) * 7)
    const anchorDay = weekDays[0] ?? weekDays[4]
    if (!anchorDay) {
      return {
        weekNum: 0,
        weekYear: year,
        isCurrent: false,
        hasLog: false,
        days: []
      }
    }
    const anchorDate = new Date(`${anchorDay.date}T00:00:00`)
    const weekNum = getISOWeekNumber(anchorDate)
    const weekYear = getISOWeekYear(anchorDate)

    return {
      weekNum,
      weekYear,
      isCurrent: weekNum === currentWeekNumber && weekYear === currentWeekYear,
      hasLog: weekDays.some(day => day.hasLog),
      days: weekDays
    }
  })
})

// 月份名称
const monthLabel = computed(() => `${calendarYear.value}年${calendarMonth.value}月`)

// 上一月
const prevMonth = () => {
  if (calendarMonth.value === 1) {
    calendarMonth.value = 12
    calendarYear.value--
  } else {
    calendarMonth.value--
  }
}

// 下一月
const nextMonth = () => {
  if (calendarMonth.value === 12) {
    calendarMonth.value = 1
    calendarYear.value++
  } else {
    calendarMonth.value++
  }
}

// 回到今天
const goToday = () => {
  const today = new Date()
  calendarYear.value = today.getFullYear()
  calendarMonth.value = today.getMonth() + 1
  selectedDate.value = formatDate(today)
  checkSelectedDate()
}

// 选中日期是否可以创建日志（不能是未来日期）
const canCreate = computed(() => {
  if (!selectedDate.value) return false
  const today = formatDate(new Date())
  return selectedDate.value <= today
})

// 选中日期的显示文本
const selectedDateLabel = computed(() => {
  if (!selectedDate.value) return ''
  const [y, m, d] = selectedDate.value.split('-')
  const weekDays = ['日', '一', '二', '三', '四', '五', '六']
  const weekDay = weekDays[new Date(selectedDate.value).getDay()]
  return `${y}年${m}月${d}日 星期${weekDay}`
})

// 点击日期
const selectDay = (dateStr: string) => {
  selectedDate.value = dateStr
  checkSelectedDate()
}

// 检查选中日期是否有日志
const checkSelectedDate = async () => {
  if (!selectedDate.value || !uid.value) return

  selectedLog.value = null
  previewContent.value = ''

  if (logDates.value.has(selectedDate.value)) {
    // 有日志，加载内容
    await loadLog()
  }
}

// 加载日志内容
const loadLog = async () => {
  previewLoading.value = true
  try {
    // 重新查询列表（确保获取最新状态，避免已删除文档残留）
    const res = await $fetch<WorklogListResponse>('/api/worklogs/list', {
      query: { owner: uid.value, year: calendarYear.value, month: calendarMonth.value }
    })
    applyMonthLogs(res.success ? (res.data?.items || []) : [])
    const item = res.data?.items?.find(i => i.date === selectedDate.value)
    if (item) {
      // 加载内容
      const docRes = await $fetch<DocumentContentResponse>(`/api/documents/${item.uuid}`, {
        params: { uid: uid.value }
      })
      if (docRes.success && docRes.data) {
        previewContent.value = docRes.data.content || ''
        selectedLog.value = { uuid: item.uuid, title: item.title, readonly_flag: (docRes.data as Record<string, unknown>).readonly_flag as number | undefined }
      } else {
        selectedLog.value = { uuid: item.uuid, title: item.title }
      }
    } else {
      // 文档已被删除（如空白日志自动清理），清除日历标记
      clearWorklogStateByDate(selectedDate.value)
    }
  } catch {
    toast.add({ title: '加载日志失败', color: 'error' })
  } finally {
    previewLoading.value = false
  }
}

// 创建日志
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
      // 刷新日志列表
      await fetchMonthLogs()
      // 直接跳转到编辑页面
      const query = res.data.existed ? {} : { new: '1' }
      navigateTo({ path: `/documents/${res.data.uuid}`, query })
    }
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '创建日志失败'), color: 'error' })
  } finally {
    isCreating.value = false
  }
}

// 编辑日志
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
      <!-- 左侧：日历 -->
      <aside
        v-if="!panelCollapsed"
        class="relative border-r border-default bg-default flex-col p-4 overflow-y-auto hidden md:flex"
        :style="{ width: panelWidth + 'px' }"
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

          <!-- 今天按钮 -->
          <div class="flex justify-center mb-3">
            <UButton
              variant="soft"
              color="primary"
              size="xs"
              @click="goToday"
            >
              今天
            </UButton>
          </div>

          <!-- 星期标题 -->
          <div class="grid grid-cols-8 text-center text-xs text-muted mb-1">
            <span class="font-medium">W</span>
            <span v-for="w in ['一', '二', '三', '四', '五', '六', '日']" :key="w">{{ w }}</span>
          </div>

          <!-- 日期网格 -->
          <div class="space-y-1">
            <div
              v-for="weekRow in calendarWeeks"
              :key="`${weekRow.weekYear}-${weekRow.weekNum}`"
              class="grid grid-cols-8 gap-1"
            >
              <div
                class="flex items-center justify-center text-[10px] font-semibold"
                :class="{
                  'text-primary': weekRow.isCurrent,
                  'text-green-600 dark:text-green-400': weekRow.hasLog && !weekRow.isCurrent,
                  'text-muted': !weekRow.isCurrent && !weekRow.hasLog
                }"
              >
                {{ weekRow.weekNum }}
              </div>
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
                <!-- 有日志的标记点 -->
                <span
                  v-if="day.hasLog"
                  class="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary"
                  :class="{ 'bg-white': day.isToday && selectedDate !== day.date }"
                />
              </button>
            </div>
          </div>

          <!-- 统计 -->
          <div class="mt-4 pt-3 border-t border-default text-xs text-muted text-center">
            本月已记录 {{ logDates.size }} 天
          </div>
        </div>

        <div v-if="monthLogs.length > 0" class="mt-4 pt-3 border-t border-default">
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
              <span class="shrink-0 text-muted tabular-nums">
                {{ item.date.slice(5) }}
              </span>
              <span class="truncate">
                {{ item.title }}
              </span>
            </button>
          </div>
        </div>
        <div v-else-if="monthLogsLoading" class="mt-4 pt-3 border-t border-default text-center">
          <UIcon name="i-lucide-loader-2" class="w-4 h-4 animate-spin text-muted" />
        </div>
      </aside>
      <!-- 拖拽调整宽度把手（aside 的兄弟元素，避免随内容滚动） -->
      <div
        v-if="!panelCollapsed"
        class="hidden md:block w-1.5 shrink-0 cursor-col-resize bg-default hover:bg-primary/40 active:bg-primary/60 transition-colors z-10 -ml-px"
        @mousedown.prevent="onResizeStart"
      />

      <!-- 右侧：日志内容 -->
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
          <!-- 未选择日期 -->
          <div v-if="!selectedDate" class="h-full flex items-center justify-center">
            <div class="text-center text-muted">
              <UIcon name="i-lucide-calendar" class="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>请在左侧日历中选择日期</p>
            </div>
          </div>

          <!-- 加载中 -->
          <div v-else-if="previewLoading" class="h-full flex items-center justify-center">
            <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
          </div>

          <!-- 有日志：预览 -->
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
              <EditorDocLazyPreview
                v-if="previewContent"
                :content="previewContent"
              />
            </div>
          </div>

          <!-- 无日志：提示创建 -->
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
                v-if="canCreate"
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
            确定要上报工作日志
            <strong class="text-default">"{{ selectedLog?.title }}"</strong> 吗？
          </p>
          <p class="text-sm text-amber-600 dark:text-amber-400 mt-2">
            上报后日志将设为只读，不可再修改。
          </p>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="outline" @click="showSubmitConfirm = false">
                取消
              </UButton>
              <UButton color="primary" :loading="isSubmitting" @click="submitLog">
                确认上报
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
