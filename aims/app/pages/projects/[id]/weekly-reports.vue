<script setup lang="ts">
import { PROJECT_ROLE_COLORS, PROJECT_ROLE_LABELS } from '~/utils/projectRoles'
import type { ProjectMember, ProjectRole } from '~/types/aims'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '项目周报',
  layoutHeaderProjectSwitcher: true
})

interface WeeklyReportEntry {
  id?: number
  reportId?: number
  projectId?: number
  uid: string
  allocationPercent: number
  hours: number
  actualHours?: number
}

interface WeeklyReportWorkItem {
  id?: number
  reportId?: number
  projectId?: number
  planType: 'this_week' | 'next_week'
  sourceType: 'manual' | 'calendar' | 'task'
  workItemId?: number | null
  moduleName: string
  sortOrder: number
  taskSummary: string
  ownerUid: string
  ownerName: string
  completionPercent: number | null
  incompleteReason: string
  workloadDays: number | null
}

interface RawWeeklyReportEntry extends Partial<WeeklyReportEntry> {
  report_id?: number
  project_id?: number
  allocation_percent?: number | string
  actual_hours?: number | string
}

interface RawWeeklyReportWorkItem extends Partial<WeeklyReportWorkItem> {
  report_id?: number
  project_id?: number
  plan_type?: 'this_week' | 'next_week'
  source_type?: 'manual' | 'calendar' | 'task'
  work_item_id?: number | string | null
  module_name?: string | null
  sort_order?: number | string
  task_summary?: string | null
  owner_uid?: string | null
  owner_name?: string | null
  completion_percent?: number | string | null
  incomplete_reason?: string | null
  workload_days?: number | string | null
}

interface ProjectWeeklyReport {
  id: number
  projectId: number
  reportYear: number
  reportWeek: number
  weekStart: string
  weekEnd: string
  mainWork: string
  overallProgress: string
  departmentName: string
  projectTypeName: string
  projectManagerName: string
  initiationStatus: string
  currentStage: string
  progressStatus: string
  completionPercent: number | null
  contractStatus: string
  contractAmount: number | null
  paymentStatus: string
  cumulativeLaborCost: number | null
  majorRisks: string
  coordinationNeeds: string
  remarks: string
  status: 'draft' | 'submitted'
  totalHours: number
  memberCount: number
  entries: WeeklyReportEntry[]
  workItems: WeeklyReportWorkItem[]
  createdAt?: string
  updatedAt?: string
}

interface RawProjectWeeklyReport {
  id?: number
  projectId?: number
  project_id?: number
  reportYear?: number
  report_year?: number
  reportWeek?: number
  report_week?: number
  weekStart?: string
  week_start?: string
  weekEnd?: string
  week_end?: string
  mainWork?: string | null
  main_work?: string | null
  overallProgress?: string | null
  overall_progress?: string | null
  departmentName?: string | null
  department_name?: string | null
  projectTypeName?: string | null
  project_type_name?: string | null
  projectManagerName?: string | null
  project_manager_name?: string | null
  initiationStatus?: string | null
  initiation_status?: string | null
  currentStage?: string | null
  current_stage?: string | null
  progressStatus?: string | null
  progress_status?: string | null
  completionPercent?: number | string | null
  completion_percent?: number | string | null
  contractStatus?: string | null
  contract_status?: string | null
  contractAmount?: number | string | null
  contract_amount?: number | string | null
  paymentStatus?: string | null
  payment_status?: string | null
  cumulativeLaborCost?: number | string | null
  cumulative_labor_cost?: number | string | null
  majorRisks?: string | null
  major_risks?: string | null
  coordinationNeeds?: string | null
  coordination_needs?: string | null
  remarks?: string | null
  status?: string
  totalHours?: number | string
  total_hours?: number | string
  memberCount?: number
  member_count?: number
  entries?: RawWeeklyReportEntry[]
  workItems?: RawWeeklyReportWorkItem[]
  work_items?: RawWeeklyReportWorkItem[]
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
}

interface ListPayload<T> {
  items?: T[]
}

interface AllocationRow {
  uid: string
  name: string
  role: ProjectRole
  status: string
  allocationPercent: number
  hours: number
  actualHours: number
}

interface RawTimeEntry {
  uid?: string
  hours?: number | string
}

interface WorkCalendarDay {
  workDate: string
  dayType: string
  isWorkday: boolean
  holidayName: string | null
  source: string
  standardHoursPerDay: number
}

interface CalendarWeekDay {
  date: string
  day: number
  isCurrentMonth: boolean
  isToday: boolean
  isFuture: boolean
  dayType: string
  isWorkday: boolean
  holidayName: string | null
  standardHoursPerDay: number
  calendarLoaded: boolean
}

const route = useRoute()
const toast = useToast()
const projectStore = useProjectStore()
const { users: accountUsers } = useAccountUsers()
const { user: authUser } = useAuth()
const { isApprovalMode } = useApprovalMode()

const projectId = computed(() => Number(route.params.id))
const defaultReportWeek = getDefaultWeeklyReportWeek()
const calendarYear = ref(defaultReportWeek.date.getFullYear())
const calendarMonth = ref(defaultReportWeek.date.getMonth() + 1)
const selectedWeekYear = ref(defaultReportWeek.year)
const selectedWeek = ref(defaultReportWeek.week)
const reports = ref<Map<string, ProjectWeeklyReport>>(new Map())
const selectedReport = ref<ProjectWeeklyReport | null>(null)
const reportsLoading = ref(false)
const reportLoading = ref(false)
const submitting = ref(false)
const mainWork = ref('')
const overallProgress = ref('')
const summaryFields = reactive({
  departmentName: '',
  projectTypeName: '',
  projectManagerName: '',
  initiationStatus: '',
  currentStage: '',
  progressStatus: '',
  completionPercent: null as number | null,
  contractStatus: '',
  contractAmount: null as number | null,
  paymentStatus: '',
  cumulativeLaborCost: null as number | null,
  majorRisks: '',
  coordinationNeeds: '',
  remarks: ''
})
const allocationRows = ref<AllocationRow[]>([])
const workItems = ref<WeeklyReportWorkItem[]>([])
const actualHoursByUid = ref<Map<string, number>>(new Map())
const workCalendarDayMap = ref<Map<string, WorkCalendarDay>>(new Map())
const loadedWorkCalendarMonths = ref<Set<string>>(new Set())
const workCalendarLoading = ref(false)
const workCalendarUnavailable = ref(false)

const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日']
const planTypeOptions = [
  { label: '本周工作', value: 'this_week' },
  { label: '下周计划', value: 'next_week' }
]
const currentWeekNumber = computed(() => getISOWeekNumber(new Date()))
const currentWeekYear = computed(() => getISOWeekYear(new Date()))
const monthLabel = computed(() => `${calendarYear.value}年${calendarMonth.value}月`)

const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const user of accountUsers.value) {
    if (user.realName?.trim()) map.set(user.uid, user.realName.trim())
  }
  return map
})

const activeMembers = computed(() => {
  return (projectStore.currentProject?.members || [])
    .filter(member => member.status === 'active')
})

const memberOptions = computed(() => activeMembers.value.map(member => ({
  label: memberName(member),
  value: member.uid
})))

const canManage = computed(() => {
  const project = projectStore.currentProject
  const uid = authUser.value
  if (!project || !uid || isApprovalMode.value) return false
  return project.leaderUid === uid || project.currentUserRole === 'manager'
})

const selectedKey = computed(() => reportKey(selectedWeekYear.value, selectedWeek.value))
const currentReport = computed(() => reports.value.get(selectedKey.value) || selectedReport.value)

const selectedWeekLabel = computed(() => {
  const { start, end } = getWeekRange(selectedWeekYear.value, selectedWeek.value)
  const weekStr = String(selectedWeek.value).padStart(2, '0')
  return `${selectedWeekYear.value}年 第${weekStr}周（${formatMonthDay(start)} ~ ${formatMonthDay(end)}）`
})
const visibleWorkCalendarMonths = computed(() => getVisibleYearMonths(calendarYear.value, calendarMonth.value))
const selectedWeekWorkdayCount = computed(() => {
  const { start } = getWeekRange(selectedWeekYear.value, selectedWeek.value)
  let count = 0
  for (let index = 0; index < 7; index++) {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const day = resolveCalendarDay(formatDate(date), date)
    if (day.isWorkday) count++
  }
  return count
})
const selectedWeekStandardHours = computed(() => {
  const { start } = getWeekRange(selectedWeekYear.value, selectedWeek.value)
  let hours = 0
  for (let index = 0; index < 7; index++) {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const day = resolveCalendarDay(formatDate(date), date)
    if (day.isWorkday) hours += day.standardHoursPerDay
  }
  return roundHours(hours)
})

const selectedWeekIsFuture = computed(() => {
  if (selectedWeekYear.value > currentWeekYear.value) return true
  if (selectedWeekYear.value < currentWeekYear.value) return false
  return selectedWeek.value > currentWeekNumber.value
})

const canSave = computed(() => {
  return canManage.value && !selectedWeekIsFuture.value && allocationRows.value.length > 0 && !submitting.value
})

const totalHours = computed(() => roundHours(allocationRows.value.reduce((sum, row) => sum + Number(row.hours || 0), 0)))
const totalActualHours = computed(() => roundHours(allocationRows.value.reduce((sum, row) => sum + Number(row.actualHours || 0), 0)))
const totalWorkloadDays = computed(() => roundHours(workItems.value.reduce((sum, row) => sum + Number(row.workloadDays || 0), 0)))
const averagePercent = computed(() => {
  if (allocationRows.value.length === 0) return 0
  return roundHours(allocationRows.value.reduce((sum, row) => sum + Number(row.allocationPercent || 0), 0) / allocationRows.value.length)
})

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
    hasReport: boolean
    days: CalendarWeekDay[]
  }[] = []

  const cursor = new Date(calStart)
  while (cursor <= calEnd) {
    const weekYear = getISOWeekYear(cursor)
    const weekNum = getISOWeekNumber(cursor)
    const days: typeof weeks[number]['days'] = []

    for (let i = 0; i < 7; i++) {
      const date = new Date(cursor)
      const dateStr = formatDate(date)
      const calendarDay = resolveCalendarDay(dateStr, date)
      days.push({
        date: dateStr,
        day: date.getDate(),
        isCurrentMonth: date.getMonth() === month && date.getFullYear() === year,
        isToday: dateStr === today,
        isFuture: isFutureDate(date),
        dayType: calendarDay.dayType,
        isWorkday: calendarDay.isWorkday,
        holidayName: calendarDay.holidayName,
        standardHoursPerDay: calendarDay.standardHoursPerDay,
        calendarLoaded: calendarDay.calendarLoaded
      })
      cursor.setDate(cursor.getDate() + 1)
    }

    weeks.push({
      weekNum,
      weekYear,
      isCurrent: weekNum === currentWeekNumber.value && weekYear === currentWeekYear.value,
      hasReport: reports.value.has(reportKey(weekYear, weekNum)),
      days
    })
  }

  return weeks
})

function normalizeReport(raw: RawProjectWeeklyReport): ProjectWeeklyReport {
  const entries = Array.isArray(raw.entries)
    ? raw.entries.map(normalizeEntry)
    : []
  const rawWorkItems = Array.isArray(raw.workItems) ? raw.workItems : (Array.isArray(raw.work_items) ? raw.work_items : [])
  return {
    id: Number(raw.id),
    projectId: Number(raw.projectId ?? raw.project_id ?? projectId.value),
    reportYear: Number(raw.reportYear ?? raw.report_year),
    reportWeek: Number(raw.reportWeek ?? raw.report_week),
    weekStart: raw.weekStart ?? raw.week_start ?? '',
    weekEnd: raw.weekEnd ?? raw.week_end ?? '',
    mainWork: raw.mainWork ?? raw.main_work ?? '',
    overallProgress: raw.overallProgress ?? raw.overall_progress ?? '',
    departmentName: raw.departmentName ?? raw.department_name ?? '',
    projectTypeName: raw.projectTypeName ?? raw.project_type_name ?? '',
    projectManagerName: raw.projectManagerName ?? raw.project_manager_name ?? '',
    initiationStatus: raw.initiationStatus ?? raw.initiation_status ?? '',
    currentStage: raw.currentStage ?? raw.current_stage ?? '',
    progressStatus: raw.progressStatus ?? raw.progress_status ?? '',
    completionPercent: toNullableNumber(raw.completionPercent ?? raw.completion_percent),
    contractStatus: raw.contractStatus ?? raw.contract_status ?? '',
    contractAmount: toNullableNumber(raw.contractAmount ?? raw.contract_amount),
    paymentStatus: raw.paymentStatus ?? raw.payment_status ?? '',
    cumulativeLaborCost: toNullableNumber(raw.cumulativeLaborCost ?? raw.cumulative_labor_cost),
    majorRisks: raw.majorRisks ?? raw.major_risks ?? '',
    coordinationNeeds: raw.coordinationNeeds ?? raw.coordination_needs ?? '',
    remarks: raw.remarks ?? '',
    status: (raw.status || 'draft') as 'draft' | 'submitted',
    totalHours: Number(raw.totalHours ?? raw.total_hours ?? 0),
    memberCount: Number(raw.memberCount ?? raw.member_count ?? entries.length),
    entries,
    workItems: rawWorkItems.map(normalizeWorkItem),
    createdAt: raw.createdAt ?? raw.created_at,
    updatedAt: raw.updatedAt ?? raw.updated_at
  }
}

function normalizeWorkItem(raw: RawWeeklyReportWorkItem): WeeklyReportWorkItem {
  return {
    id: raw.id ? Number(raw.id) : undefined,
    reportId: raw.reportId ?? raw.report_id,
    projectId: raw.projectId ?? raw.project_id,
    planType: (raw.planType ?? raw.plan_type ?? 'this_week') as 'this_week' | 'next_week',
    sourceType: (raw.sourceType ?? raw.source_type ?? 'manual') as 'manual' | 'calendar' | 'task',
    workItemId: toNullableNumber(raw.workItemId ?? raw.work_item_id),
    moduleName: raw.moduleName ?? raw.module_name ?? '',
    sortOrder: Number(raw.sortOrder ?? raw.sort_order ?? 0),
    taskSummary: raw.taskSummary ?? raw.task_summary ?? '',
    ownerUid: raw.ownerUid ?? raw.owner_uid ?? '',
    ownerName: raw.ownerName ?? raw.owner_name ?? '',
    completionPercent: toNullableNumber(raw.completionPercent ?? raw.completion_percent),
    incompleteReason: raw.incompleteReason ?? raw.incomplete_reason ?? '',
    workloadDays: toNullableNumber(raw.workloadDays ?? raw.workload_days)
  }
}

function normalizeEntry(raw: RawWeeklyReportEntry): WeeklyReportEntry {
  return {
    id: raw.id ? Number(raw.id) : undefined,
    reportId: raw.reportId ?? raw.report_id,
    projectId: raw.projectId ?? raw.project_id,
    uid: raw.uid || '',
    allocationPercent: Number(raw.allocationPercent ?? raw.allocation_percent ?? 100),
    hours: Number(raw.hours ?? weeklyStandardHours()),
    actualHours: Number(raw.actualHours ?? raw.actual_hours ?? 0)
  }
}

function normalizeWorkCalendarDay(raw: Record<string, unknown>): WorkCalendarDay | null {
  const workDate = String(raw.workDate ?? raw.work_date ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return null
  const dayType = String(raw.dayType ?? raw.day_type ?? '').trim() || 'workday'
  const isWorkdayValue = raw.isWorkday ?? raw.is_workday
  return {
    workDate,
    dayType,
    isWorkday: isWorkdayValue === true || isWorkdayValue === 1 || isWorkdayValue === '1' || isWorkdayValue === 'true',
    holidayName: String(raw.holidayName ?? raw.holiday_name ?? '').trim() || null,
    source: String(raw.source ?? '').trim(),
    standardHoursPerDay: positiveNumber(raw.standardHoursPerDay ?? raw.standard_hours_per_day, 8)
  }
}

async function fetchReportCalendar() {
  if (!projectId.value) return
  reportsLoading.value = true
  try {
    const years = new Set<number>([calendarYear.value])
    if (calendarMonth.value === 1) years.add(calendarYear.value - 1)
    if (calendarMonth.value === 12) years.add(calendarYear.value + 1)

    const next = new Map(reports.value)
    for (const [key] of next) {
      const keyYear = Number(key.split('-')[0])
      if (years.has(keyYear)) next.delete(key)
    }

    for (const year of years) {
      const res = await $fetch<{ code: number, data: ListPayload<RawProjectWeeklyReport> }>(
        `/api/v1/projects/${projectId.value}/weekly-reports`,
        { query: { year } }
      )
      if (res.code === 0) {
        for (const item of res.data.items || []) {
          const report = normalizeReport(item)
          next.set(reportKey(report.reportYear, report.reportWeek), report)
        }
      }
    }
    reports.value = next
  } catch (error) {
    console.error('[ProjectWeeklyReports] fetch calendar failed:', error)
    toast.add({ title: '加载周报日历失败', color: 'error' })
  } finally {
    reportsLoading.value = false
  }
}

async function fetchWorkCalendarDays() {
  const missingMonths = visibleWorkCalendarMonths.value
    .filter(yearMonth => !loadedWorkCalendarMonths.value.has(yearMonth))
  if (missingMonths.length === 0) return

  workCalendarLoading.value = true
  try {
    const nextDays = new Map(workCalendarDayMap.value)
    const nextLoadedMonths = new Set(loadedWorkCalendarMonths.value)

    for (const yearMonth of missingMonths) {
      const res = await $fetch<{ code: number, data: ListPayload<Record<string, unknown>> }>(
        '/api/work-calendars/CN/days',
        { query: { yearMonth } }
      )
      if (res.code === 0) {
        for (const item of res.data.items || []) {
          const day = normalizeWorkCalendarDay(item)
          if (day) nextDays.set(day.workDate, day)
        }
        nextLoadedMonths.add(yearMonth)
      }
    }

    workCalendarDayMap.value = nextDays
    loadedWorkCalendarMonths.value = nextLoadedMonths
    workCalendarUnavailable.value = false
  } catch (error) {
    console.warn('[ProjectWeeklyReports] load work calendar failed:', error)
    workCalendarUnavailable.value = true
  } finally {
    workCalendarLoading.value = false
  }
}

async function loadSelectedReport() {
  if (!projectId.value || selectedWeek.value === null) return
  reportLoading.value = true
  selectedReport.value = null
  try {
    await fetchActualHours()
    const res = await $fetch<{ code: number, data: ListPayload<RawProjectWeeklyReport> }>(
      `/api/v1/projects/${projectId.value}/weekly-reports`,
      {
        query: {
          year: selectedWeekYear.value,
          week: selectedWeek.value,
          includeEntries: '1'
        }
      }
    )
    const report = res.code === 0 && res.data.items?.[0]
      ? normalizeReport(res.data.items[0])
      : null
    selectedReport.value = report
    if (report) {
      const next = new Map(reports.value)
      next.set(reportKey(report.reportYear, report.reportWeek), report)
      reports.value = next
    }
    resetForm(report)
  } catch (error) {
    console.error('[ProjectWeeklyReports] load report failed:', error)
    toast.add({ title: '加载周报失败', color: 'error' })
    resetForm(null)
  } finally {
    reportLoading.value = false
  }
}

async function fetchActualHours() {
  actualHoursByUid.value = new Map()
  const { start, end } = getWeekRange(selectedWeekYear.value, selectedWeek.value)
  const res = await $fetch<{ code: number, data: ListPayload<RawTimeEntry> }>(
    `/api/v1/projects/${projectId.value}/time-entries`,
    {
      query: {
        startDate: formatDate(start),
        endDate: formatDate(end)
      }
    }
  )
  if (res.code !== 0) return

  const next = new Map<string, number>()
  for (const entry of res.data.items || []) {
    const uid = String(entry.uid || '').trim()
    if (!uid) continue
    next.set(uid, roundHours((next.get(uid) || 0) + Number(entry.hours || 0)))
  }
  actualHoursByUid.value = next
}

function resetForm(report: ProjectWeeklyReport | null) {
  const project = projectStore.currentProject
  const standardHours = weeklyStandardHours()
  mainWork.value = report?.mainWork || ''
  overallProgress.value = report?.overallProgress || ''
  summaryFields.departmentName = report?.departmentName || project?.deptCode || ''
  summaryFields.projectTypeName = report?.projectTypeName || project?.category || ''
  summaryFields.projectManagerName = report?.projectManagerName || userNameMap.value.get(project?.leaderUid || '') || project?.leaderUid || ''
  summaryFields.initiationStatus = report?.initiationStatus || ''
  summaryFields.currentStage = report?.currentStage || project?.lifecycleStatus || ''
  summaryFields.progressStatus = report?.progressStatus || ''
  summaryFields.completionPercent = report?.completionPercent ?? null
  summaryFields.contractStatus = report?.contractStatus || project?.contractCode || ''
  summaryFields.contractAmount = report?.contractAmount ?? null
  summaryFields.paymentStatus = report?.paymentStatus || ''
  summaryFields.cumulativeLaborCost = report?.cumulativeLaborCost ?? null
  summaryFields.majorRisks = report?.majorRisks || ''
  summaryFields.coordinationNeeds = report?.coordinationNeeds || ''
  summaryFields.remarks = report?.remarks || ''
  workItems.value = report?.workItems?.length ? report.workItems.map((item, index) => ({ ...item, sortOrder: item.sortOrder || index + 1 })) : [newWorkItem()]

  const entryMap = new Map((report?.entries || []).map(entry => [entry.uid, entry]))
  const members = activeMembers.value
  const rows: AllocationRow[] = []

  for (const member of members) {
    const entry = entryMap.get(member.uid)
    rows.push({
      uid: member.uid,
      name: memberName(member),
      role: member.role,
      status: member.status,
      allocationPercent: roundHours(entry?.allocationPercent ?? 100),
      hours: roundHours(entry?.hours ?? standardHours),
      actualHours: roundHours(actualHoursByUid.value.get(member.uid) || entry?.actualHours || 0)
    })
    entryMap.delete(member.uid)
  }

  for (const entry of entryMap.values()) {
    rows.push({
      uid: entry.uid,
      name: userNameMap.value.get(entry.uid) || entry.uid,
      role: 'member',
      status: 'inactive',
      allocationPercent: roundHours(entry.allocationPercent),
      hours: roundHours(entry.hours),
      actualHours: roundHours(actualHoursByUid.value.get(entry.uid) || entry.actualHours || 0)
    })
  }

  allocationRows.value = rows
}

async function saveReport() {
  if (!canSave.value) return
  submitting.value = true
  try {
    const res = await $fetch<{ code: number, data: RawProjectWeeklyReport }>(
      `/api/v1/projects/${projectId.value}/weekly-reports`,
      {
        method: 'POST',
        body: {
          reportYear: selectedWeekYear.value,
          reportWeek: selectedWeek.value,
          mainWork: mainWork.value,
          overallProgress: overallProgress.value,
          ...summaryFields,
          status: currentReport.value?.status || 'draft',
          entries: allocationRows.value.map(row => ({
            uid: row.uid,
            allocationPercent: roundHours(row.allocationPercent),
            hours: roundHours(row.hours)
          })),
          workItems: workItems.value
            .filter(item => item.taskSummary.trim())
            .map((item, index) => ({
              planType: item.planType,
              sourceType: item.sourceType,
              workItemId: item.workItemId || null,
              moduleName: item.moduleName,
              sortOrder: index + 1,
              taskSummary: item.taskSummary,
              ownerUid: item.ownerUid,
              ownerName: item.ownerName,
              completionPercent: item.completionPercent,
              incompleteReason: item.incompleteReason,
              workloadDays: item.workloadDays
            }))
        }
      }
    )
    if (res.code === 0) {
      const report = normalizeReport(res.data)
      selectedReport.value = report
      const next = new Map(reports.value)
      next.set(reportKey(report.reportYear, report.reportWeek), report)
      reports.value = next
      resetForm(report)
      toast.add({ title: '周报已保存', color: 'success' })
    }
  } catch (error) {
    console.error('[ProjectWeeklyReports] save failed:', error)
    toast.add({ title: getErrorMessage(error, '保存周报失败'), color: 'error' })
  } finally {
    submitting.value = false
  }
}

async function selectWeek(weekYear: number, weekNum: number) {
  selectedWeekYear.value = weekYear
  selectedWeek.value = weekNum
  await fetchWorkCalendarDays()
  await loadSelectedReport()
}

function prevMonth() {
  if (calendarMonth.value === 1) {
    calendarMonth.value = 12
    calendarYear.value--
  } else {
    calendarMonth.value--
  }
}

function nextMonth() {
  if (calendarMonth.value === 12) {
    calendarMonth.value = 1
    calendarYear.value++
  } else {
    calendarMonth.value++
  }
}

async function goCurrentWeek() {
  const today = new Date()
  calendarYear.value = today.getFullYear()
  calendarMonth.value = today.getMonth() + 1
  selectedWeekYear.value = currentWeekYear.value
  selectedWeek.value = currentWeekNumber.value
  await fetchWorkCalendarDays()
  await loadSelectedReport()
}

function isWeekSelected(weekYear: number, weekNum: number) {
  return selectedWeekYear.value === weekYear && selectedWeek.value === weekNum
}

function updatePercent(row: AllocationRow, value: unknown) {
  const percent = clampNumber(value, 0, 999.99)
  row.allocationPercent = roundHours(percent)
  row.hours = roundHours(percent / 100 * weeklyStandardHours())
}

function updateHours(row: AllocationRow, value: unknown) {
  const hours = clampNumber(value, 0, 168)
  const standardHours = weeklyStandardHours()
  row.hours = roundHours(hours)
  row.allocationPercent = standardHours > 0 ? roundHours(hours / standardHours * 100) : 0
}

function newWorkItem(): WeeklyReportWorkItem {
  return {
    planType: 'this_week',
    sourceType: 'manual',
    workItemId: null,
    moduleName: '',
    sortOrder: workItems.value.length + 1,
    taskSummary: '',
    ownerUid: '',
    ownerName: '',
    completionPercent: null,
    incompleteReason: '',
    workloadDays: null
  }
}

function addWorkItem() {
  workItems.value.push(newWorkItem())
}

function removeWorkItem(index: number) {
  workItems.value.splice(index, 1)
  if (workItems.value.length === 0) {
    workItems.value.push(newWorkItem())
  }
}

function setWorkItemOwner(item: WeeklyReportWorkItem, uid: string) {
  item.ownerUid = uid
  const member = activeMembers.value.find(member => member.uid === uid)
  item.ownerName = member ? memberName(member) : (userNameMap.value.get(uid) || uid)
}

function memberName(member: ProjectMember) {
  return member.realName || userNameMap.value.get(member.uid) || member.uid
}

function roleLabel(role: ProjectRole) {
  return PROJECT_ROLE_LABELS[role] || role
}

function roleColor(role: ProjectRole) {
  const color = PROJECT_ROLE_COLORS[role]
  if (color === 'primary' || color === 'success' || color === 'neutral') return color
  return 'neutral'
}

function reportKey(year: number, week: number) {
  return `${year}-${week}`
}

function positiveNumber(value: unknown, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function weeklyStandardHours() {
  const hours = Number(selectedWeekStandardHours.value)
  return Number.isFinite(hours) && hours >= 0 ? hours : 40
}

function getVisibleYearMonths(year: number, monthNo: number) {
  const month = monthNo - 1
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startWeekDay = firstDay.getDay() || 7
  const calStart = new Date(firstDay)
  calStart.setDate(firstDay.getDate() - (startWeekDay - 1))
  const endWeekDay = lastDay.getDay() || 7
  const calEnd = new Date(lastDay)
  calEnd.setDate(lastDay.getDate() + (7 - endWeekDay))

  const months = new Set<string>()
  const cursor = new Date(calStart)
  cursor.setDate(1)
  while (cursor <= calEnd) {
    months.add(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return Array.from(months)
}

function resolveCalendarDay(dateStr: string, date: Date) {
  const calendarDay = workCalendarDayMap.value.get(dateStr)
  if (calendarDay) {
    return {
      dayType: calendarDay.dayType,
      isWorkday: calendarDay.isWorkday,
      holidayName: calendarDay.holidayName,
      standardHoursPerDay: positiveNumber(calendarDay.standardHoursPerDay, 8),
      calendarLoaded: true
    }
  }

  const dayOfWeek = date.getDay()
  const isWorkday = dayOfWeek >= 1 && dayOfWeek <= 5
  return {
    dayType: isWorkday ? 'workday' : 'weekend',
    isWorkday,
    holidayName: null,
    standardHoursPerDay: 8,
    calendarLoaded: false
  }
}

function workCalendarDayLabel(dayType: string) {
  const labels: Record<string, string> = {
    workday: '工作日',
    weekend: '休息日',
    public_holiday: '法定假日',
    transfer_workday: '调休工作日',
    custom_holiday: '休息日',
    custom_workday: '工作日'
  }
  return labels[dayType] || dayType
}

function workCalendarShortLabel(dayType: string) {
  const labels: Record<string, string> = {
    workday: '工作',
    weekend: '休息',
    public_holiday: '假日',
    transfer_workday: '调休',
    custom_holiday: '休息',
    custom_workday: '工作'
  }
  return labels[dayType] || '日'
}

function calendarDayClasses(day: CalendarWeekDay) {
  const classes = ['border']
  if (day.dayType === 'public_holiday' || day.dayType === 'custom_holiday') {
    classes.push('border-error/30 bg-error/10 text-error')
  } else if (day.dayType === 'transfer_workday' || day.dayType === 'custom_workday') {
    classes.push('border-warning/30 bg-warning/10 text-warning')
  } else if (day.dayType === 'weekend') {
    classes.push('border-default bg-muted text-muted')
  } else {
    classes.push('border-transparent text-default')
  }

  if (!day.isCurrentMonth || (day.isCurrentMonth && day.isFuture && !day.isToday)) {
    classes.push('opacity-60')
  }
  if (day.isToday) {
    classes.push('ring-1 ring-primary')
  }
  return classes.join(' ')
}

function calendarDayTitle(day: CalendarWeekDay) {
  const holiday = day.holidayName ? `：${day.holidayName}` : ''
  return `${day.date} ${workCalendarDayLabel(day.dayType)}${holiday}`
}

function formatDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatMonthDay(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}

function isFutureDate(date: Date) {
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return target.getTime() > today.getTime()
}

function getISOWeekNumber(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function getISOWeekYear(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  return d.getUTCFullYear()
}

function getWeekRange(year: number, week: number) {
  const jan4 = new Date(year, 0, 4)
  const dayOfWeek = jan4.getDay() || 7
  const week1Monday = new Date(jan4)
  week1Monday.setDate(jan4.getDate() - dayOfWeek + 1)
  const start = new Date(week1Monday)
  start.setDate(week1Monday.getDate() + (week - 1) * 7)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { start, end }
}

function roundHours(value: number) {
  return Math.round(Number(value || 0) * 100) / 100
}

function clampNumber(value: unknown, min: number, max: number) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return min
  return Math.min(max, Math.max(min, numeric))
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function getErrorMessage(error: unknown, fallback: string) {
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

watch([calendarYear, calendarMonth], () => {
  fetchReportCalendar()
  fetchWorkCalendarDays()
})

watch(activeMembers, () => {
  resetForm(selectedReport.value)
})

onMounted(async () => {
  if (!projectStore.currentProject || projectStore.currentProject.id !== projectId.value) {
    await projectStore.fetchProject(projectId.value)
  }
  await projectStore.fetchMembers(projectId.value)
  await Promise.all([
    fetchReportCalendar(),
    fetchWorkCalendarDays()
  ])
  await loadSelectedReport()
})
</script>

<template>
  <UDashboardPanel id="project-weekly-reports" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <ProjectNavbar />

        <div class="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(17rem,19rem)_minmax(0,1fr)]">
          <aside class="flex min-h-0 flex-col border-b border-default bg-default/80 xl:border-r xl:border-b-0">
            <div class="border-b border-default px-4 py-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-highlighted">
                    周报日历
                  </p>
                  <p class="text-xs text-muted">
                    {{ reportsLoading ? '加载中...' : `已填报 ${reports.size} 份` }}
                    <span v-if="workCalendarLoading"> · 工作日历加载中</span>
                    <span v-else-if="workCalendarUnavailable"> · 使用默认周末</span>
                  </p>
                </div>
                <UButton
                  variant="soft"
                  color="primary"
                  size="xs"
                  icon="i-lucide-calendar-days"
                  label="本周"
                  @click="goCurrentWeek"
                />
              </div>

              <div class="mt-4 flex items-center justify-between gap-2">
                <UButton
                  icon="i-lucide-chevron-left"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  square
                  @click="prevMonth"
                />
                <span class="min-w-32 text-center text-sm font-semibold text-highlighted">{{ monthLabel }}</span>
                <UButton
                  icon="i-lucide-chevron-right"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  square
                  @click="nextMonth"
                />
              </div>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto p-3">
              <div class="mb-2 grid grid-cols-8 px-1 text-center text-xs text-muted">
                <span class="font-medium">W</span>
                <span v-for="label in weekdayLabels" :key="label">{{ label }}</span>
              </div>

              <div class="space-y-2">
                <div
                  v-for="weekRow in calendarWeeks"
                  :key="`${weekRow.weekYear}-${weekRow.weekNum}`"
                  class="grid grid-cols-8 items-center gap-1"
                >
                  <div
                    class="flex items-center justify-center text-[10px] font-semibold"
                    :class="{
                      'text-primary': weekRow.isCurrent,
                      'text-success': weekRow.hasReport && !weekRow.isCurrent,
                      'text-muted': !weekRow.isCurrent && !weekRow.hasReport
                    }"
                  >
                    {{ weekRow.weekNum }}
                  </div>

                  <button
                    class="col-span-7 grid grid-cols-7 rounded-lg border border-default bg-default px-1 py-2 text-center text-xs transition hover:bg-elevated"
                    :class="{
                      'border-primary bg-primary/10 font-semibold ring-2 ring-primary/30': isWeekSelected(weekRow.weekYear, weekRow.weekNum) && !weekRow.days.every(day => day.isFuture),
                      'border-muted bg-muted text-muted ring-2 ring-muted/30': isWeekSelected(weekRow.weekYear, weekRow.weekNum) && weekRow.days.every(day => day.isFuture),
                      'border-success/30 bg-success/10': weekRow.hasReport && !isWeekSelected(weekRow.weekYear, weekRow.weekNum),
                      'opacity-70': weekRow.days.every(day => day.isFuture)
                    }"
                    @click="selectWeek(weekRow.weekYear, weekRow.weekNum)"
                  >
                    <span
                      v-for="day in weekRow.days"
                      :key="day.date"
                      class="mx-auto flex h-8 min-w-7 flex-col items-center justify-center rounded-md px-1 leading-none"
                      :class="calendarDayClasses(day)"
                      :title="calendarDayTitle(day)"
                    >
                      <span class="text-[11px] font-semibold">{{ day.day }}</span>
                      <span class="mt-0.5 text-[8px]">{{ workCalendarShortLabel(day.dayType) }}</span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </aside>

          <main class="min-h-0 min-w-0 overflow-y-auto bg-elevated/20 px-4 py-4 pb-12">
            <div class="mx-auto w-full max-w-[104rem] space-y-4">
              <div class="rounded-lg border border-default bg-default px-4 py-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <h2 class="text-lg font-semibold text-highlighted">
                        {{ selectedWeekLabel }}
                      </h2>
                      <UBadge
                        color="success"
                        variant="subtle"
                        size="sm"
                      >
                        工作日 {{ selectedWeekWorkdayCount }} 天
                      </UBadge>
                      <UBadge
                        color="neutral"
                        variant="subtle"
                        size="sm"
                      >
                        标准 {{ selectedWeekStandardHours.toFixed(1) }}h
                      </UBadge>
                      <UBadge
                        v-if="currentReport"
                        :color="currentReport.status === 'submitted' ? 'success' : 'neutral'"
                        variant="subtle"
                        size="sm"
                      >
                        {{ currentReport.status === 'submitted' ? '已提交' : '草稿' }}
                      </UBadge>
                      <UBadge
                        v-else
                        variant="outline"
                        color="neutral"
                        size="sm"
                      >
                        未填报
                      </UBadge>
                    </div>
                    <p class="mt-1 text-sm text-muted">
                      项目经理填报本周主要工作、整体进展，并认定成员周投入。
                    </p>
                  </div>

                  <UButton
                    v-if="canManage"
                    icon="i-lucide-save"
                    label="保存周报"
                    color="primary"
                    :loading="submitting"
                    :disabled="!canSave"
                    @click="saveReport"
                  />
                </div>

                <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <div class="rounded-lg border border-default bg-elevated/40 px-3 py-2">
                    <div class="text-xs text-muted">
                      项目成员
                    </div>
                    <div class="mt-1 text-lg font-semibold text-highlighted">
                      {{ allocationRows.length }}
                    </div>
                  </div>
                  <div class="rounded-lg border border-default bg-elevated/40 px-3 py-2">
                    <div class="text-xs text-muted">
                      认定工时
                    </div>
                    <div class="mt-1 text-lg font-semibold text-highlighted">
                      {{ totalHours.toFixed(1) }}h
                    </div>
                  </div>
                  <div class="rounded-lg border border-default bg-elevated/40 px-3 py-2">
                    <div class="text-xs text-muted">
                      成员填报
                    </div>
                    <div class="mt-1 text-lg font-semibold text-highlighted">
                      {{ totalActualHours.toFixed(1) }}h
                    </div>
                  </div>
                  <div class="rounded-lg border border-default bg-elevated/40 px-3 py-2">
                    <div class="text-xs text-muted">
                      平均投入
                    </div>
                    <div class="mt-1 text-lg font-semibold text-highlighted">
                      {{ averagePercent.toFixed(0) }}%
                    </div>
                  </div>
                  <div class="rounded-lg border border-default bg-elevated/40 px-3 py-2">
                    <div class="text-xs text-muted">
                      工作项
                    </div>
                    <div class="mt-1 text-lg font-semibold text-highlighted">
                      {{ totalWorkloadDays.toFixed(1) }} 人日
                    </div>
                  </div>
                </div>
              </div>

              <div v-if="reportLoading" class="flex justify-center py-16">
                <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-muted" />
              </div>

              <div v-else-if="selectedWeekIsFuture" class="rounded-lg border border-default bg-default px-6 py-16 text-center text-muted">
                <UIcon name="i-lucide-calendar-clock" class="mx-auto mb-3 size-12" />
                <p>未来周暂不可填报</p>
              </div>

              <template v-else>
                <div class="rounded-lg border border-default bg-default p-4">
                  <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 class="text-sm font-semibold text-highlighted">
                        本周概述
                      </h3>
                      <p class="text-xs text-muted">
                        记录本周项目主要工作和整体推进情况
                      </p>
                    </div>
                  </div>

                  <div class="grid gap-4 lg:grid-cols-2">
                    <UFormField label="主要工作">
                      <UTextarea
                        v-model="mainWork"
                        :disabled="!canManage"
                        :rows="8"
                        class="w-full"
                        placeholder="填写本周项目主要工作"
                      />
                    </UFormField>
                    <UFormField label="整体进展">
                      <UTextarea
                        v-model="overallProgress"
                        :disabled="!canManage"
                        :rows="8"
                        class="w-full"
                        placeholder="填写项目整体进展"
                      />
                    </UFormField>
                  </div>
                </div>

                <div class="rounded-lg border border-default bg-default p-4">
                  <div class="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h3 class="text-sm font-semibold text-highlighted">
                        汇总字段
                      </h3>
                      <p class="text-xs text-muted">
                        用于项目周报汇总表，可由项目总监统一查看和导出
                      </p>
                    </div>
                  </div>
                  <div class="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
                    <UFormField label="隶属部门">
                      <UInput
                        v-model="summaryFields.departmentName"
                        :disabled="!canManage"
                        class="w-full"
                      />
                    </UFormField>
                    <UFormField label="项目类型">
                      <UInput
                        v-model="summaryFields.projectTypeName"
                        :disabled="!canManage"
                        class="w-full"
                      />
                    </UFormField>
                    <UFormField label="项目经理">
                      <UInput
                        v-model="summaryFields.projectManagerName"
                        :disabled="!canManage"
                        class="w-full"
                      />
                    </UFormField>
                    <UFormField label="立项情况">
                      <UInput
                        v-model="summaryFields.initiationStatus"
                        :disabled="!canManage"
                        class="w-full"
                      />
                    </UFormField>
                    <UFormField label="当前阶段">
                      <UInput
                        v-model="summaryFields.currentStage"
                        :disabled="!canManage"
                        class="w-full"
                      />
                    </UFormField>
                    <UFormField label="进度情况">
                      <UInput
                        v-model="summaryFields.progressStatus"
                        :disabled="!canManage"
                        class="w-full"
                      />
                    </UFormField>
                    <UFormField label="总体完成进度">
                      <div class="flex items-center gap-2">
                        <UInput
                          v-model="summaryFields.completionPercent"
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          :disabled="!canManage"
                          class="min-w-0 flex-1"
                        />
                        <span class="text-sm text-muted">%</span>
                      </div>
                    </UFormField>
                    <UFormField label="合同额">
                      <UInput
                        v-model="summaryFields.contractAmount"
                        type="number"
                        min="0"
                        step="1000"
                        :disabled="!canManage"
                        class="w-full"
                      />
                    </UFormField>
                    <UFormField label="合同状态" class="md:col-span-2">
                      <UInput
                        v-model="summaryFields.contractStatus"
                        :disabled="!canManage"
                        class="w-full"
                      />
                    </UFormField>
                    <UFormField label="回款情况" class="md:col-span-2">
                      <UInput
                        v-model="summaryFields.paymentStatus"
                        :disabled="!canManage"
                        class="w-full"
                      />
                    </UFormField>
                    <UFormField label="累计人力成本">
                      <UInput
                        v-model="summaryFields.cumulativeLaborCost"
                        type="number"
                        min="0"
                        step="1000"
                        :disabled="!canManage"
                        class="w-full"
                      />
                    </UFormField>
                    <UFormField label="备注" class="md:col-span-2 2xl:col-span-3">
                      <UInput
                        v-model="summaryFields.remarks"
                        :disabled="!canManage"
                        class="w-full"
                      />
                    </UFormField>
                    <UFormField label="重大问题和风险" class="md:col-span-2">
                      <UTextarea
                        v-model="summaryFields.majorRisks"
                        :disabled="!canManage"
                        :rows="3"
                        class="w-full"
                      />
                    </UFormField>
                    <UFormField label="待协调资源" class="md:col-span-2">
                      <UTextarea
                        v-model="summaryFields.coordinationNeeds"
                        :disabled="!canManage"
                        :rows="3"
                        class="w-full"
                      />
                    </UFormField>
                  </div>
                </div>

                <div class="overflow-hidden rounded-lg border border-default bg-default">
                  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-default px-4 py-3">
                    <div>
                      <h3 class="text-sm font-semibold text-highlighted">
                        周报工作项
                      </h3>
                      <p class="text-xs text-muted">
                        工作量按人日填写；后续可由项目日历和任务自动生成
                      </p>
                    </div>
                    <div class="flex items-center gap-3">
                      <span class="text-sm text-muted">{{ totalWorkloadDays.toFixed(1) }} 人日</span>
                      <UButton
                        v-if="canManage"
                        icon="i-lucide-plus"
                        label="新增工作项"
                        size="sm"
                        variant="soft"
                        @click="addWorkItem"
                      />
                    </div>
                  </div>

                  <div class="space-y-3 p-4">
                    <div
                      v-for="(item, index) in workItems"
                      :key="`${index}-${item.id || 'new'}`"
                      class="rounded-lg border border-default bg-elevated/30 p-3"
                    >
                      <div class="grid gap-3 lg:grid-cols-[8rem_minmax(10rem,14rem)_minmax(10rem,14rem)_8rem_8rem_2.5rem] lg:items-start">
                        <UFormField label="工作/计划">
                          <USelect
                            v-model="item.planType"
                            :items="planTypeOptions"
                            :disabled="!canManage"
                            class="w-full"
                          />
                        </UFormField>
                        <UFormField label="模块名称">
                          <UInput
                            v-model="item.moduleName"
                            :disabled="!canManage"
                            class="w-full"
                          />
                        </UFormField>
                        <UFormField label="责任人">
                          <USelect
                            :model-value="item.ownerUid"
                            :items="memberOptions"
                            :disabled="!canManage"
                            class="w-full"
                            @update:model-value="value => setWorkItemOwner(item, String(value || ''))"
                          />
                        </UFormField>
                        <UFormField label="完成度">
                          <div class="flex items-center gap-2">
                            <UInput
                              v-model="item.completionPercent"
                              type="number"
                              min="0"
                              max="100"
                              step="5"
                              :disabled="!canManage"
                              class="min-w-0 flex-1"
                            />
                            <span class="text-sm text-muted">%</span>
                          </div>
                        </UFormField>
                        <UFormField label="工作量">
                          <div class="flex items-center gap-2">
                            <UInput
                              v-model="item.workloadDays"
                              type="number"
                              min="0"
                              max="999.99"
                              step="0.5"
                              :disabled="!canManage"
                              class="min-w-0 flex-1"
                            />
                            <span class="text-sm text-muted">人日</span>
                          </div>
                        </UFormField>
                        <div class="flex justify-end lg:pt-6">
                          <UButton
                            v-if="canManage"
                            icon="i-lucide-trash-2"
                            color="error"
                            variant="ghost"
                            size="sm"
                            aria-label="删除工作项"
                            @click="removeWorkItem(index)"
                          />
                        </div>
                      </div>

                      <div class="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)]">
                        <UFormField label="任务简述">
                          <UTextarea
                            v-model="item.taskSummary"
                            :disabled="!canManage"
                            :rows="3"
                            class="w-full"
                          />
                        </UFormField>
                        <UFormField label="未完成情况说明">
                          <UTextarea
                            v-model="item.incompleteReason"
                            :disabled="!canManage"
                            :rows="3"
                            class="w-full"
                          />
                        </UFormField>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="overflow-hidden rounded-lg border border-default bg-default">
                  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-default px-4 py-3">
                    <div>
                      <h3 class="text-sm font-semibold text-highlighted">
                        成员工时认定
                      </h3>
                      <p class="text-xs text-muted">
                        100% 投入按本周标准 {{ selectedWeekStandardHours.toFixed(1) }}h 折算；成员填报工时来自个人每日工时记录
                      </p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2 text-sm">
                      <UBadge color="primary" variant="subtle">
                        认定 {{ totalHours.toFixed(1) }}h
                      </UBadge>
                      <UBadge color="neutral" variant="subtle">
                        填报 {{ totalActualHours.toFixed(1) }}h
                      </UBadge>
                      <UBadge color="success" variant="subtle">
                        {{ averagePercent.toFixed(0) }}%
                      </UBadge>
                    </div>
                  </div>

                  <div v-if="allocationRows.length === 0" class="px-4 py-12 text-center text-muted">
                    暂无项目成员
                  </div>

                  <div v-else class="space-y-2 p-4">
                    <div class="hidden grid-cols-[minmax(0,1fr)_10rem_10rem_9rem] gap-3 px-2 text-xs font-medium text-muted md:grid">
                      <span>成员</span>
                      <span>投入比例</span>
                      <span>认定工时</span>
                      <span>成员填报</span>
                    </div>

                    <div
                      v-for="row in allocationRows"
                      :key="row.uid"
                      class="grid gap-3 rounded-lg border border-default bg-elevated/30 p-3 md:grid-cols-[minmax(0,1fr)_10rem_10rem_9rem] md:items-center"
                    >
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                          <div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                            {{ row.name.slice(0, 1) }}
                          </div>
                          <div class="min-w-0">
                            <div class="truncate text-sm font-medium text-highlighted">
                              {{ row.name }}
                            </div>
                            <div class="truncate text-xs text-muted">
                              {{ row.uid }}
                            </div>
                          </div>
                          <UBadge :color="roleColor(row.role)" variant="subtle" size="xs">
                            {{ roleLabel(row.role) }}
                          </UBadge>
                          <UBadge
                            v-if="row.status !== 'active'"
                            color="warning"
                            variant="subtle"
                            size="xs"
                          >
                            非活跃
                          </UBadge>
                        </div>
                      </div>

                      <div class="flex items-center gap-2">
                        <UInput
                          :model-value="row.allocationPercent"
                          type="number"
                          min="0"
                          max="999.99"
                          step="5"
                          :disabled="!canManage"
                          class="min-w-0 flex-1"
                          @update:model-value="value => updatePercent(row, value)"
                        />
                        <span class="w-5 shrink-0 text-sm text-muted">%</span>
                      </div>

                      <div class="flex items-center gap-2">
                        <UInput
                          :model-value="row.hours"
                          type="number"
                          min="0"
                          max="168"
                          step="0.5"
                          :disabled="!canManage"
                          class="min-w-0 flex-1"
                          @update:model-value="value => updateHours(row, value)"
                        />
                        <span class="w-4 shrink-0 text-sm text-muted">h</span>
                      </div>

                      <div class="flex items-center justify-between gap-2 rounded-md bg-default px-3 py-2 text-sm text-muted md:bg-transparent md:px-0 md:py-0">
                        <span class="md:hidden">成员填报</span>
                        <span class="font-medium text-highlighted">{{ row.actualHours.toFixed(1) }}h</span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </main>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
