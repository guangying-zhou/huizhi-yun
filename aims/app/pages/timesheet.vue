<script setup lang="ts">
import ContentPageHeader from '../../../foundation/app/components/ContentPageHeader.vue'
import { reviewStatusLabel, reviewStatusColor, type TimeEntryReviewStatus } from '../utils/timeEntryPresentation'
import { useAimsModule } from '../../layer/useAimsModule'
import type { AimsProject, ProjectRole } from '../types/aims'
import { isProjectProjection, type ProjectGroupPage } from '../utils/projectOverviewPagination'
import { useTimeEntryReadPage, useTimeEntryPage } from '../composables/useTimeEntryPage'
import { editedDayHours, refreshTimeEntryDraftBaselines, reportingToday } from '../utils/timeEntryPagination'
import { createCommandIntents } from '../utils/commandIntent'
import { timesheetWeekSubmitErrorMessage } from '../utils/timesheetWeekSubmitError'
import { useProjectStore } from '../stores/project'

// 同一份代码供独立应用与企业宿主使用：非宿主模式下 moduleUrl 原样返回路径。
const { moduleUrl, hosted } = useAimsModule()
definePageMeta({
  hostContentInset: false,
  layoutHeader: true,
  layoutHeaderTitle: '项目日历',
  layoutHeaderProjectSwitcher: false
})

type SubmitMode = 'hours' | 'percent'

interface RawTimeEntry {
  id: number
  workItemId?: number | null
  work_item_id?: number | null
  projectId?: number
  project_id?: number
  projectCode?: string
  project_code?: string
  projectName?: string
  project_name?: string
  projectShortName?: string
  project_short_name?: string
  itemKey?: string
  item_key?: string
  itemTitle?: string
  item_title?: string
  title?: string
  uid: string
  entryDate?: string
  entry_date?: string
  hours: number | string
  description?: string | null
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
  reviewStatus?: TimeEntryReviewStatus
  review_status?: TimeEntryReviewStatus
  reviewRoute?: 'project_manager' | 'company_summary' | null
  review_route?: 'project_manager' | 'company_summary' | null
  returnReason?: string | null
  return_reason?: string | null
}

interface TimeEntry {
  id: number
  workItemId: number | null
  projectId: number
  projectCode: string
  projectName: string
  projectShortName: string
  itemKey: string
  itemTitle: string
  uid: string
  entryDate: string
  hours: number
  description: string | null
  createdAt: string
  updatedAt: string
  reviewStatus: TimeEntryReviewStatus
  reviewRoute: 'project_manager' | 'company_summary' | null
  returnReason: string | null
}

interface ProjectTimeRow {
  projectId: number
  hours: number
  percent: number
  existingHours: number
}

interface TimeEntryEditRow {
  id: number | null
  key: string
  projectId: number
  projectName: string
  projectCode: string
  itemKey: string
  itemTitle: string
  hours: number
  originalHours: number
  description: string
  originalDescription: string
  reviewStatus: TimeEntryReviewStatus
  returnReason: string
  editable: boolean
}

const toast = useToast()
const { user: authUser } = useAuth()
const { loaded: permissionsLoaded, loadPermissions, hasPermission, error: permissionsError } = usePermissions()
// 填报、新增、保存修改与整周提交都要求 timesheet:submit（与 Host/Runtime 同一动作）。
// 权限未加载前按无权处理，避免入口先可点、再被服务端 403。
const canSubmitTimesheet = computed(() => permissionsLoaded.value && hasPermission('timesheet', 'submit'))
// 权限快照加载失败时入口仍禁用，但不能把“未知”说成“无权”（宿主另有加载失败提示）。
const submitPermissionDenied = computed(() => permissionsLoaded.value && !permissionsError.value && !canSubmitTimesheet.value)
const SUBMIT_PERMISSION_DENIED_REASON = '当前账号没有工时填报权限，仅可查看已填工时；如需填报请联系管理员开通。'
const { users: accountUsers } = useAccountUsers()
const projectStore = useProjectStore()

const currentMonth = ref(startOfMonth(dateFromKey(reportingToday(new Date()))))
const selectedProjectId = ref<number | 'all'>('all')
const calendarRead = useTimeEntryPage<RawTimeEntry>()
const timeEntryIntents = createCommandIntents()
const dayRead = useTimeEntryPage<RawTimeEntry>()
const entriesLoading = calendarRead.loading
const dayLoading = dayRead.loading
const entries = computed(() => (dayRead.data.value?.items || []).map(normalizeEntry))
const summary = computed(() => calendarRead.data.value?.summary)
// 403 是确定的无权限结果，重试不会改变；只对其他失败提供重新加载。
const calendarForbidden = computed(() => calendarRead.error.value && calendarRead.errorStatus.value === 403)
const dayForbidden = computed(() => dayRead.error.value && dayRead.errorStatus.value === 403)
const dayTotal = computed(() => dayRead.data.value?.total || 0)
const { page: detailPage, pageSize: detailPageSize } = useListPage({ pageSize: 20, syncUrl: false })
const { confirm } = useConfirm()
const modalOpen = ref(false)
const detailModalOpen = ref(false)
const selectedDate = ref(reportingToday(new Date()))
const submitting = ref(false)
const detailSubmitting = ref(false)
const weekSubmitting = ref(false)
const weekSubmitModalOpen = ref(false)
const projectsLoading = ref(false)
const candidateRead = useTimeEntryReadPage<ProjectGroupPage>(isProjectProjection)
const candidatePage = ref(1)
const { search: candidateSearch, debounced: candidateSearchDebounced } = useDebouncedSearch()
const candidateProjects = computed(() => (candidateRead.data.value?.items || []).map(projectStore.normalizeProject))
const pinnedProject = ref<AimsProject | null>(null)
const candidateTotal = computed(() => candidateRead.data.value?.total || 0)
async function readCandidates(page = 1) {
  candidatePage.value = page
  await candidateRead.read(moduleUrl('/api/v1/projects'), { projection: 'candidates', page, pageSize: 20, search: candidateSearchDebounced.value || undefined })
  if ([401, 403].includes(candidateRead.errorStatus.value || 0)) {
    pinnedProject.value = null
    selectedProjectId.value = 'all'
    projectTimeRows.value = []
    modalOpen.value = false
  }
}
watch(candidateSearchDebounced, () => {
  if (hosted) void readCandidates()
})
watch(candidateRead.fingerprint, () => {
  pinnedProject.value = null
  candidatePage.value = 1
  candidateSearch.value = ''
}, { flush: 'sync' })
const projectMemberRoles = ref<Map<number, ProjectRole>>(new Map())
const projectTimeRows = ref<ProjectTimeRow[]>([])
const detailRows = ref<TimeEntryEditRow[]>([])

const form = reactive<{
  mode: SubmitMode
  description: string
}>({
  mode: 'hours',
  description: ''
})

const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日']
const reportingTimezone = ref('Asia/Shanghai')
const todayKey = computed(() => reportingToday(new Date(), reportingTimezone.value))
const monthStartKey = computed(() => formatLocalDate(startOfMonth(currentMonth.value)))
const monthEndKey = computed(() => formatLocalDate(endOfMonth(currentMonth.value)))
const monthTitle = computed(() => {
  const year = currentMonth.value.getFullYear()
  const month = currentMonth.value.getMonth() + 1
  return `${year}年${month}月`
})
const selectedPeriodKey = computed(() => isoPeriodKey(selectedDate.value))
const selectedWeekRange = computed(() => isoWeekRange(selectedDate.value))
const selectedWeekEditableCount = computed(() => (summary.value?.weekStatusCounts.draft || 0) + (summary.value?.weekStatusCounts.returned || 0))
const selectedWeekSubmittedCount = computed(() => summary.value?.weekStatusCounts.submitted || 0)
const weekSubmitDisabledReason = computed(() => {
  if (!permissionsLoaded.value) return '正在核对工时填报权限'
  if (permissionsError.value) return '工时填报权限暂不可用，请稍后重试'
  if (submitPermissionDenied.value) return SUBMIT_PERMISSION_DENIED_REASON
  if (selectedWeekRange.value.start > todayKey.value) return '不能提交未来周'
  if (entriesLoading.value || !summary.value) return '正在加载所选周工时'
  if (selectedWeekEditableCount.value === 0) return '所选周尚无可提交的草稿工时'
  return ''
})
const queryStartKey = computed(() => selectedWeekRange.value.start < monthStartKey.value ? selectedWeekRange.value.start : monthStartKey.value)
const queryEndKey = computed(() => selectedWeekRange.value.end > monthEndKey.value ? selectedWeekRange.value.end : monthEndKey.value)

const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const item of accountUsers.value) {
    if (item.realName?.trim()) map.set(item.uid, item.realName.trim())
  }
  return map
})

const availableProjects = computed(() => {
  const uid = authUser.value
  if (hosted) return candidateProjects.value
  return projectStore.projects.filter((project) => {
    if (project.lifecycleStatus === 'archived' || project.canAccess === false) return false
    if (!uid) return false
    if (project.leaderUid === uid) return true
    const role = project.currentUserRole || projectMemberRoles.value.get(project.id)
    if (role === 'manager' || role === 'member') return true
    return false
  })
})

const selectedProject = computed(() => {
  if (selectedProjectId.value === 'all') return null
  return availableProjects.value.find(project => project.id === selectedProjectId.value) || pinnedProject.value || null
})

const projectHours = computed(() => new Map((summary.value?.projectHours || []).map(row => [row.projectId, row])))
const totalMonthHours = computed(() => summary.value?.monthHours || 0)
const submittedDays = computed(() => summary.value?.monthPositiveDays || 0)
const missingDays = computed(() => summary.value?.monthMissingDays || 0)

const reportableRows = computed(() => {
  return projectTimeRows.value
    .map(row => ({ ...row, submitHours: rowSubmitHours(row) }))
    .filter(row => row.submitHours > 0)
})

const reportTotalHours = computed(() => {
  return roundHours(reportableRows.value.reduce((sum, row) => sum + row.submitHours, 0))
})

const reportTotalPercent = computed(() => {
  return roundHours(projectTimeRows.value.reduce((sum, row) => sum + Math.max(0, Number(row.percent || 0)), 0))
})

const reportSubmitDisabled = computed(() => {
  if (!summary.value || entriesLoading.value || submitting.value || reportableRows.value.length === 0) return true
  if (reportTotalHours.value > 24) return true
  if (form.mode === 'percent' && reportTotalPercent.value > 100) return true
  return false
})

const detailTotalHours = computed(() => {
  return editedDayHours(dayRead.data.value?.summary.totalHours || 0, detailRows.value)
})

const changedDetailRows = computed(() => {
  return detailRows.value.filter(row => rowChanged(row))
})

const detailSubmitDisabled = computed(() => {
  if (!canSubmitTimesheet.value) return true
  if (!dayRead.data.value || dayRead.error.value || dayLoading.value || detailSubmitting.value || changedDetailRows.value.length === 0) return true
  if (changedDetailRows.value.some(row => !validDetailRowHours(row))) return true
  if (detailTotalHours.value > 24) return true
  return false
})

const calendarDays = computed(() => {
  const first = startOfMonth(currentMonth.value)
  const firstWeekday = (first.getDay() + 6) % 7
  const gridStart = addDays(first, -firstWeekday)
  const month = first.getMonth()

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index)
    const dateKey = formatLocalDate(date)
    const totalHours = summary.value?.dailyHours.find(day => day.date === dateKey)?.hours || 0
    const projectGroups = (summary.value?.dailyProjectHours || []).filter(group => group.date === dateKey)
    return {
      date,
      dateKey,
      dayNumber: date.getDate(),
      inMonth: date.getMonth() === month,
      isToday: dateKey === todayKey.value,
      isPastOrToday: dateKey <= todayKey.value,
      totalHours,
      projectGroups
    }
  })
})

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function formatLocalDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year || 1970, (month || 1) - 1, day || 1, 12)
}

function isoPeriodKey(value: string) {
  const source = dateFromKey(value)
  const utc = new Date(Date.UTC(source.getFullYear(), source.getMonth(), source.getDate()))
  const weekday = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - weekday)
  const isoYear = utc.getUTCFullYear()
  const yearStart = new Date(Date.UTC(isoYear, 0, 1))
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${isoYear}-W${pad(week)}`
}

function isoWeekRange(value: string) {
  const source = dateFromKey(value)
  const weekday = source.getDay() || 7
  const monday = addDays(source, 1 - weekday)
  return {
    start: formatLocalDate(monday),
    end: formatLocalDate(addDays(monday, 6))
  }
}

function normalizeDateOnly(value: string | null | undefined) {
  return String(value || '').slice(0, 10)
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function roundHours(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

function normalizeEntry(raw: RawTimeEntry): TimeEntry {
  return {
    id: Number(raw.id),
    workItemId: raw.workItemId ?? raw.work_item_id ?? null,
    projectId: Number(raw.projectId ?? raw.project_id ?? 0),
    projectCode: raw.projectCode || raw.project_code || '',
    projectName: raw.projectName || raw.project_name || '',
    projectShortName: raw.projectShortName || raw.project_short_name || '',
    itemKey: raw.itemKey || raw.item_key || '',
    itemTitle: raw.itemTitle || raw.item_title || raw.title || '',
    uid: raw.uid,
    entryDate: normalizeDateOnly(raw.entryDate || raw.entry_date),
    hours: Number(raw.hours || 0),
    description: raw.description || null,
    createdAt: raw.createdAt || raw.created_at || '',
    updatedAt: raw.updatedAt || raw.updated_at || '',
    reviewStatus: raw.reviewStatus || raw.review_status || 'draft',
    reviewRoute: raw.reviewRoute || raw.review_route || null,
    returnReason: raw.returnReason || raw.return_reason || null
  }
}

function projectDisplayName(project: AimsProject) {
  return project.shortName || project.name
}

function projectRoleLabel(project: AimsProject) {
  if (project.leaderUid === authUser.value) return '管理'
  const role = project.currentUserRole || projectMemberRoles.value.get(project.id)
  if (role === 'manager' || role === 'member') return '参与'
  return '可访问'
}

function getLeaderName(project: AimsProject) {
  if (!project.leaderUid) return '未设置'
  return userNameMap.value.get(project.leaderUid) || project.leaderUid
}

function selectProject(projectId: number | 'all') {
  pinnedProject.value = projectId === 'all' ? null : availableProjects.value.find(project => project.id === projectId) || null
  selectedProjectId.value = projectId
}

function dayClass(day: { inMonth: boolean, isToday: boolean, isPastOrToday: boolean, totalHours: number }) {
  const classes = ['border-default']
  if (!day.inMonth) {
    classes.push('bg-elevated/30 opacity-60')
  } else if (day.totalHours >= 8) {
    classes.push('border-success/30 bg-success/10')
  } else if (day.totalHours > 0) {
    classes.push('border-warning/30 bg-warning/10')
  } else if (day.isPastOrToday) {
    classes.push('border-error/25 bg-error/5')
  } else {
    classes.push('bg-default')
  }
  if (day.isToday) {
    classes.push('ring-2 ring-primary/40')
  }
  return classes.join(' ')
}

function goPreviousMonth() {
  currentMonth.value = addMonths(currentMonth.value, -1)
}

function goNextMonth() {
  currentMonth.value = addMonths(currentMonth.value, 1)
}

function goCurrentMonth() {
  currentMonth.value = startOfMonth(new Date())
}

async function loadProjects() {
  if (!authUser.value) return
  const identity = calendarRead.fingerprint.value
  if (hosted) {
    await readCandidates()
    return
  }
  projectsLoading.value = true
  try {
    if (projectStore.projects.length === 0) {
      await projectStore.fetchProjects({ pageSize: 500 })
    }
    if (identity !== calendarRead.fingerprint.value) return
    await loadProjectMemberRoles()
  } finally {
    if (identity === calendarRead.fingerprint.value) projectsLoading.value = false
  }
}

async function loadProjectMemberRoles() {
  const uid = authUser.value
  if (!uid) return

  const identity = calendarRead.fingerprint.value
  const roles = new Map<number, ProjectRole>()
  const targets = projectStore.projects.filter(project => project.leaderUid !== uid)
  const batchSize = 8

  for (let index = 0; index < targets.length; index += batchSize) {
    const batch = targets.slice(index, index + batchSize)
    await Promise.all(batch.map(async (project) => {
      try {
        const members = await projectStore.fetchMembers(project.id)
        const currentMember = members.find(member => member.uid === uid && member.status === 'active')
        if (currentMember?.role) {
          roles.set(project.id, currentMember.role)
        }
      } catch {
        // 成员读取失败时只影响该项目是否进入个人日历，不阻塞页面。
      }
    }))
  }

  if (identity === calendarRead.fingerprint.value && uid === authUser.value) projectMemberRoles.value = roles
}

async function loadEntries() {
  if (!authUser.value) {
    calendarRead.clear()
    return
  }
  const data = await calendarRead.read(moduleUrl(`/api/v1/users/${encodeURIComponent(authUser.value)}/time-entries`), {
    startDate: queryStartKey.value, endDate: queryEndKey.value, page: 1, pageSize: 1,
    calendarProjectId: selectedProjectId.value === 'all' ? undefined : String(selectedProjectId.value),
    monthStart: monthStartKey.value, monthEnd: monthEndKey.value, todayDate: todayKey.value,
    weekStart: selectedWeekRange.value.start, weekEnd: selectedWeekRange.value.end
  })
  if (data?.calendarTimezone && data.calendarTimezone !== reportingTimezone.value) {
    const previousToday = todayKey.value
    reportingTimezone.value = data.calendarTimezone
    if (selectedDate.value === previousToday) selectedDate.value = todayKey.value
    if (formatLocalDate(currentMonth.value).slice(0, 7) === previousToday.slice(0, 7)) currentMonth.value = startOfMonth(dateFromKey(todayKey.value))
    await loadEntries()
  }
}

async function loadDayEntries() {
  if (!authUser.value) {
    dayRead.clear()
    detailRows.value = []
    return
  }
  const data = await dayRead.read(moduleUrl(`/api/v1/users/${encodeURIComponent(authUser.value)}/time-entries`), {
    startDate: selectedDate.value, endDate: selectedDate.value, page: detailPage.value, pageSize: detailPageSize
  })
  if (!data) {
    if (dayRead.error.value) detailRows.value = []
    return
  }
  detailRows.value = entries.value.map(detailRowFromEntry)
  if (!data.items.length && detailPage.value > 1) {
    detailPage.value = Math.max(1, Math.ceil(data.total / detailPageSize))
    await loadDayEntries()
  }
}

async function changeDetailPage(page: number) {
  if (page === detailPage.value || detailSubmitting.value) return
  if (changedDetailRows.value.length && !await confirm({ title: '放弃未保存修改', message: '翻页将放弃当前页工时的未保存修改，是否继续？', confirmLabel: '放弃并翻页', tone: 'warning' })) return
  detailPage.value = page
  detailRows.value = []
  await loadDayEntries()
}

function projectRowsForDate(dateKey: string) {
  const projects = [...availableProjects.value]
  if (hosted && pinnedProject.value && !projects.some(project => project.id === pinnedProject.value!.id)) projects.unshift(pinnedProject.value)
  if (selectedProjectId.value !== 'all') {
    const selectedIndex = projects.findIndex(project => project.id === selectedProjectId.value)
    if (selectedIndex > 0) {
      const [selected] = projects.splice(selectedIndex, 1)
      if (selected) projects.unshift(selected)
    }
  }

  return projects.map(project => ({
    projectId: project.id,
    hours: 0,
    percent: 0,
    existingHours: (summary.value?.baseDailyProjectHours || []).find(row => row.date === dateKey && row.projectId === project.id)?.hours || 0
  }))
}

function rowProject(projectId: number) {
  return availableProjects.value.find(project => project.id === projectId) || (pinnedProject.value?.id === projectId ? pinnedProject.value : null)
}

function rowProjectName(projectId: number) {
  const project = rowProject(projectId)
  return project ? projectDisplayName(project) : `项目 ${projectId}`
}

function rowProjectCode(projectId: number) {
  return rowProject(projectId)?.projectCode || `#${projectId}`
}

function rowProjectRoleLabel(projectId: number) {
  const project = rowProject(projectId)
  return project ? projectRoleLabel(project) : ''
}

function rowProjectRoleColor(projectId: number): 'primary' | 'neutral' {
  return rowProjectRoleLabel(projectId) === '管理' ? 'primary' : 'neutral'
}

function rowSubmitHours(row: ProjectTimeRow) {
  const value = form.mode === 'percent'
    ? Number(row.percent || 0) * 8 / 100
    : Number(row.hours || 0)
  if (value <= 0) return 0
  return roundHours(value)
}

function resetReportRows(dateKey: string) {
  projectTimeRows.value = projectRowsForDate(dateKey)
}

function entryProjectName(entry: TimeEntry) {
  return entry.projectShortName || entry.projectName || `项目 ${entry.projectId}`
}

function entryProjectCode(entry: TimeEntry) {
  return entry.projectCode || `#${entry.projectId}`
}

function detailRowFromEntry(entry: TimeEntry): TimeEntryEditRow {
  return {
    id: entry.id,
    key: `entry-${entry.id}`,
    projectId: entry.projectId,
    projectName: entryProjectName(entry),
    projectCode: entryProjectCode(entry),
    itemKey: entry.itemKey,
    itemTitle: entry.itemTitle,
    hours: entry.hours,
    originalHours: entry.hours,
    description: entry.description || '',
    originalDescription: entry.description || '',
    reviewStatus: entry.reviewStatus,
    returnReason: entry.returnReason || '',
    editable: entry.reviewStatus === 'draft' || entry.reviewStatus === 'returned'
  }
}

async function openDayDetailModal(day: { inMonth: boolean, dateKey: string, totalHours: number }) {
  if (!day.inMonth || day.totalHours <= 0 || detailSubmitting.value) return
  selectedDate.value = day.dateKey
  detailPage.value = 1
  detailRows.value = []
  dayRead.clear()
  detailModalOpen.value = true
  await loadDayEntries()
}

function openReportFromDetail() {
  detailModalOpen.value = false
  openReportModal(selectedDate.value)
}

function openReportModal(dateKey: string) {
  if (!canSubmitTimesheet.value) return
  selectedDate.value = dateKey
  form.mode = 'hours'
  form.description = ''
  resetReportRows(dateKey)
  modalOpen.value = true
}

async function submitTimeEntry() {
  const rows = reportableRows.value
  if (rows.length === 0) {
    toast.add({ title: '请至少为一个项目填写有效工时', color: 'warning' })
    return
  }
  if (reportTotalHours.value > 24) {
    toast.add({ title: '单日工时不能超过 24 小时', color: 'warning' })
    return
  }
  if (form.mode === 'percent' && reportTotalPercent.value > 100) {
    toast.add({ title: '投入比例合计不能超过 100%', color: 'warning' })
    return
  }

  submitting.value = true
  try {
    await Promise.all(rows.map(row => postProjectTimeEntry(row)))
    for (const row of rows) timeEntryIntents.complete(`report-create:${selectedDate.value}:${row.projectId}`)
    toast.add({ title: `已填报 ${rows.length} 个项目，共 ${reportTotalHours.value.toFixed(1)}h`, color: 'success' })
    modalOpen.value = false
    await loadEntries()
  } catch (err: unknown) {
    console.error('[ProjectCalendar] submit time entry failed:', err)
    const message = (err as { data?: { message?: string } })?.data?.message || '填报失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    submitting.value = false
  }
}

function postProjectTimeEntry(row: ProjectTimeRow & { submitHours: number }) {
  return createProjectTimeEntry(row.projectId, row.submitHours, form.description || null, `report-create:${selectedDate.value}:${row.projectId}`)
}

function createProjectTimeEntry(projectId: number, hours: number, description: string | null, intent: string) {
  const url = moduleUrl(`/api/v1/projects/${projectId}/time-entries`) as string
  const body = { entryDate: selectedDate.value, hours, description }
  return $fetch(url, {
    method: 'POST',
    body, headers: timeEntryIntents.headers(intent, body), retry: 0
  })
}

function postDetailTimeEntry(row: TimeEntryEditRow) {
  return createProjectTimeEntry(row.projectId, roundHours(Number(row.hours || 0)), row.description.trim() || null, detailTimeEntryIntent(row))
}

function detailTimeEntryIntent(row: TimeEntryEditRow) {
  return row.id === null
    ? `detail-create:${selectedDate.value}:${row.projectId}`
    : roundHours(Number(row.hours || 0)) <= 0 ? `detail-delete:${row.id}` : `detail-update:${row.id}`
}

function rowChanged(row: TimeEntryEditRow) {
  if (!row.editable) return false
  if (row.id === null) {
    return roundHours(Number(row.hours || 0)) !== 0
  }
  return roundHours(Number(row.hours || 0)) !== row.originalHours
    || row.description.trim() !== row.originalDescription.trim()
}

async function submitSelectedWeek() {
  if (weekSubmitDisabledReason.value) return
  weekSubmitting.value = true
  try {
    const response = await $fetch<{
      code: number
      data: { submittedCount: number, managerRouteCount: number, summaryRouteCount: number }
    }>(moduleUrl(`/api/v1/timesheet/weeks/${selectedPeriodKey.value}:submit`), {
      method: 'POST'
    })
    weekSubmitModalOpen.value = false
    toast.add({
      title: `已提交 ${response.data.submittedCount} 条工时`,
      description: response.data.summaryRouteCount > 0
        ? `其中 ${response.data.summaryRouteCount} 条项目经理职责工时将随公司周报汇总确认`
        : '已按填报日期分派给对应项目经理或代理审核',
      color: 'success'
    })
    await loadEntries()
  } catch (err: unknown) {
    console.error('[ProjectCalendar] submit timesheet week failed:', err)
    toast.add({ title: timesheetWeekSubmitErrorMessage(err), color: 'error' })
  } finally {
    weekSubmitting.value = false
  }
}

function validDetailRowHours(row: TimeEntryEditRow) {
  const hours = roundHours(Number(row.hours || 0))
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) return false
  if (row.id === null) return hours > 0
  return true
}

async function submitDetailChanges() {
  const rows = changedDetailRows.value
  if (rows.length === 0 || !dayRead.data.value || dayRead.error.value || dayLoading.value) return
  if (detailTotalHours.value > 24) {
    toast.add({ title: '单日工时不能超过 24 小时', color: 'warning' })
    return
  }
  const invalid = rows.some(row => !validDetailRowHours(row))
  if (invalid) {
    toast.add({ title: '新增工时必须大于 0；已有工时可清零删除，且单条不超过 24 小时', color: 'warning' })
    return
  }

  detailSubmitting.value = true
  try {
    await Promise.all(rows.map(saveDetailTimeEntry))
    for (const row of rows) timeEntryIntents.complete(detailTimeEntryIntent(row))
    toast.add({ title: `已保存 ${rows.length} 条工时记录`, color: 'success' })
    detailModalOpen.value = false
    await loadEntries()
  } catch (err: unknown) {
    console.error('[ProjectCalendar] update time entry failed:', err)
    const message = (err as { data?: { message?: string } })?.data?.message || '更新失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    detailSubmitting.value = false
  }
}

function saveDetailTimeEntry(row: TimeEntryEditRow) {
  if (row.id === null) return postDetailTimeEntry(row)
  if (roundHours(Number(row.hours || 0)) <= 0) return deleteProjectTimeEntry(row)
  return patchProjectTimeEntry(row)
}

function patchProjectTimeEntry(row: TimeEntryEditRow) {
  if (row.id === null) return postDetailTimeEntry(row)
  const url = moduleUrl(`/api/v1/projects/${row.projectId}/time-entries/${row.id}`) as string
  const body = { hours: roundHours(Number(row.hours || 0)), description: row.description.trim() || null }
  return $fetch(url, {
    method: 'PATCH',
    body, headers: timeEntryIntents.headers(detailTimeEntryIntent(row), body), retry: 0
  })
}

function deleteProjectTimeEntry(row: TimeEntryEditRow) {
  if (row.id === null) return Promise.resolve()
  const url = moduleUrl(`/api/v1/projects/${row.projectId}/time-entries/${row.id}`) as string
  return $fetch(url, { method: 'DELETE', headers: timeEntryIntents.headers(detailTimeEntryIntent(row)), retry: 0 })
}

watch([modalOpen, detailModalOpen], ([reportOpen, detailOpen]) => {
  if (!reportOpen && !detailOpen) timeEntryIntents.clear()
})

// The date change may cancel the previous summary while the draft stays open.
// Refresh only the persisted baseline, preserving the user's current inputs.
watch(summary, (value) => {
  if (!modalOpen.value || !value) return
  projectTimeRows.value = refreshTimeEntryDraftBaselines(projectTimeRows.value, value.baseDailyProjectHours, selectedDate.value)
})

watch([currentMonth, selectedDate, selectedProjectId], () => {
  void loadEntries()
}, {
  flush: 'sync'
})
watch(calendarRead.fingerprint, () => {
  detailRows.value = []
  detailModalOpen.value = false
  modalOpen.value = false
  weekSubmitModalOpen.value = false
  projectTimeRows.value = []
  projectMemberRoles.value = new Map()
  projectsLoading.value = false
  if (calendarRead.fingerprint.value) {
    void loadProjects()
    void loadEntries()
  }
}, { flush: 'sync' })

onMounted(async () => {
  await Promise.all([
    permissionsLoaded.value ? undefined : loadPermissions(),
    loadProjects().then(() => loadEntries())
  ])
})
</script>

<template>
  <UDashboardPanel id="project-calendar" style="container-type: inline-size" :ui="{ root: 'relative flex min-w-0 shrink-0 flex-col h-full', body: 'flex min-h-0 flex-1 flex-col p-0 overflow-hidden' }">
    <template #body>
      <div
        class="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(12rem,30%)_minmax(0,1fr)] xl:grid-cols-[minmax(15rem,20%)_minmax(0,1fr)] xl:grid-rows-1 host-timesheet-grid"
        :class="hosted ? 'is-hosted' : ''"
      >
        <div v-if="hosted" class="col-span-full host-timesheet-header px-4 pt-4 sm:px-6 sm:pt-6">
          <ContentPageHeader
            :hosted="hosted"
            title="工时日历"
            description="按项目和日期查看、填写与提交工时记录。"
            breadcrumb="交付与服务 / 执行协同"
          >
            <template #actions>
              <div class="flex flex-col items-start gap-1">
                <UButton
                  :label="`提交 ${selectedPeriodKey} 审核`"
                  icon="i-lucide-send"
                  color="primary"
                  size="sm"
                  :disabled="!!weekSubmitDisabledReason || weekSubmitting"
                  :title="weekSubmitDisabledReason || undefined"
                  @click="weekSubmitModalOpen = true"
                />
                <p v-if="weekSubmitDisabledReason" class="max-w-64 text-xs text-muted" role="status">
                  {{ weekSubmitDisabledReason }}
                </p>
              </div>
            </template>
          </ContentPageHeader>
        </div>
        <aside
          class="flex min-h-0 flex-col border-b border-default bg-default/80 xl:border-r xl:border-b-0"
        >
          <div class="flex items-center justify-between gap-3 px-4 py-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-highlighted">
                我的项目
              </p>
              <p class="text-xs text-muted">
                {{ hosted ? candidateTotal : availableProjects.length }} 个管理或参与项目
              </p>
            </div>
            <UButton
              label="全部"
              size="xs"
              :color="selectedProjectId === 'all' ? 'primary' : 'neutral'"
              :variant="selectedProjectId === 'all' ? 'soft' : 'ghost'"
              @click="selectProject('all')"
            />
          </div>

          <div v-if="hosted" class="space-y-2 px-3 pb-3">
            <UInput v-model="candidateSearch" placeholder="搜索项目名或编码" class="w-full" />
            <div class="text-xs text-muted">
              共 {{ candidateTotal }} 条
            </div>
            <UPagination
              :sibling-count="0"
              size="xs"
              :page="candidatePage"
              :items-per-page="20"
              :total="candidateTotal"
              @update:page="readCandidates"
            />
            <UButton v-if="candidateRead.error.value" label="读取失败，重试" @click="readCandidates(candidatePage)" />
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto p-3">
            <div v-if="projectsLoading || (hosted ? candidateRead.loading.value : projectStore.loading)" class="space-y-2">
              <USkeleton v-for="index in 4" :key="index" class="h-24 rounded-lg" />
            </div>

            <div v-else-if="availableProjects.length === 0" class="rounded-lg border border-dashed border-default px-4 py-10 text-center text-sm text-muted">
              <UIcon name="i-lucide-folder-open" class="mx-auto mb-2 size-8" />
              暂无可填报项目
            </div>

            <div v-else class="space-y-2">
              <button
                v-for="project in availableProjects"
                :key="project.id"
                type="button"
                class="w-full rounded-lg border p-2 text-left transition hover:bg-elevated"
                :class="selectedProjectId === project.id ? 'border-primary bg-primary/10' : 'border-default bg-default'"
                @click="selectProject(project.id)"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">
                    {{ projectDisplayName(project) }}
                  </span>
                  <UBadge :color="projectRoleLabel(project) === '管理' ? 'primary' : 'neutral'" variant="subtle" size="xs">
                    {{ projectRoleLabel(project) }}
                  </UBadge>
                </div>
                <div class="mt-0.5 truncate font-mono text-xs text-muted" :title="`${project.projectCode} · ${getLeaderName(project)}`">
                  {{ project.projectCode }} · {{ getLeaderName(project) }}
                </div>
                <div class="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div class="flex items-center justify-between gap-2 text-muted">
                    <span>填报天数</span>
                    <span class="tabular-nums text-toned">{{ projectHours.get(project.id)?.distinctEntryDays || 0 }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-2 text-muted">
                    <span>工时</span>
                    <span class="tabular-nums text-toned">{{ (projectHours.get(project.id)?.hours || 0).toFixed(1) }}h</span>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </aside>

        <main class="flex min-h-0 min-w-0 flex-col bg-elevated/20">
          <div class="flex flex-col gap-3 border-b border-default bg-default px-4 py-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div class="flex flex-wrap items-center gap-2">
              <UButton
                icon="i-lucide-chevron-left"
                color="neutral"
                variant="ghost"
                square
                @click="goPreviousMonth"
              />
              <div class="min-w-36 text-center text-base font-semibold text-highlighted">
                {{ monthTitle }}
              </div>
              <UButton
                icon="i-lucide-chevron-right"
                color="neutral"
                variant="ghost"
                square
                @click="goNextMonth"
              />
              <UButton
                label="本月"
                icon="i-lucide-calendar-days"
                color="neutral"
                variant="soft"
                size="sm"
                @click="goCurrentMonth"
              />
            </div>

            <div class="flex flex-wrap items-center gap-2 text-sm">
              <UInput
                v-model="selectedDate"
                type="date"
                aria-label="选择待提交工时所在周"
                class="w-36"
              />
              <div v-if="!hosted" class="flex flex-col items-start gap-1">
                <UButton
                  :label="`提交 ${selectedPeriodKey} 审核`"
                  icon="i-lucide-send"
                  color="primary"
                  size="sm"
                  :disabled="!!weekSubmitDisabledReason || weekSubmitting"
                  :title="weekSubmitDisabledReason || undefined"
                  @click="weekSubmitModalOpen = true"
                />
                <p v-if="weekSubmitDisabledReason" class="max-w-64 text-xs text-muted" role="status">
                  {{ weekSubmitDisabledReason }}
                </p>
              </div>
              <UBadge color="neutral" variant="subtle">
                {{ selectedProject ? projectDisplayName(selectedProject) : '全部项目' }}
              </UBadge>
              <UBadge v-if="summary" color="primary" variant="subtle">
                {{ totalMonthHours.toFixed(1) }}h
              </UBadge>
              <UBadge v-if="summary" color="success" variant="subtle">
                已填 {{ submittedDays }} 天
              </UBadge>
              <UBadge v-if="summary" color="warning" variant="subtle">
                待填 {{ missingDays }} 天
              </UBadge>
            </div>
          </div>

          <!-- Only the calendar block scrolls sideways; the container query keeps
               the swipe hint in step with the block's own width in Host and standalone. -->
          <div class="@container min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4">
            <UAlert
              v-if="calendarForbidden"
              color="warning"
              icon="i-lucide-shield-alert"
              title="无权查看工时"
              description="当前账号没有本人工时的查看或填报权限，请联系管理员开通。"
              class="mb-4"
            />
            <UAlert
              v-else-if="submitPermissionDenied"
              color="info"
              icon="i-lucide-lock"
              title="无工时填报权限"
              :description="SUBMIT_PERMISSION_DENIED_REASON"
              class="mb-4"
              data-testid="timesheet-submit-permission-denied"
            />
            <UAlert
              v-if="calendarRead.error.value && !calendarForbidden"
              color="error"
              title="工时汇总加载失败"
              description="请重试；当前未显示填报统计。"
              class="mb-4"
            />
            <UButton
              v-if="calendarRead.error.value && !calendarForbidden"
              label="重新加载"
              color="neutral"
              variant="outline"
              class="mb-4"
              @click="loadEntries()"
            />
            <p class="mb-2 text-xs text-muted @min-[38rem]:hidden" data-testid="timesheet-calendar-scroll-hint">
              左右滑动查看完整周历，点击日期查看工时。
            </p>
            <div class="overflow-x-auto overscroll-x-contain pb-1" data-testid="timesheet-calendar-scroll">
              <div class="min-w-[38rem] space-y-2">
                <div class="grid grid-cols-7 gap-2">
                  <div
                    v-for="label in weekdayLabels"
                    :key="label"
                    class="rounded-md border border-default bg-default px-3 py-2 text-center text-xs font-medium text-muted"
                  >
                    周{{ label }}
                  </div>
                </div>

                <div v-if="entriesLoading" class="grid grid-cols-7 gap-2">
                  <USkeleton v-for="index in 42" :key="index" class="h-36 rounded-lg" />
                </div>

                <div v-else class="grid grid-cols-7 gap-2">
                  <div
                    v-for="day in calendarDays"
                    :key="day.dateKey"
                    class="flex min-h-36 flex-col rounded-lg border p-2"
                    :class="[dayClass(day), day.totalHours > 0 ? 'cursor-pointer transition hover:bg-elevated' : '']"
                    @click="openDayDetailModal(day)"
                  >
                    <div class="flex items-start justify-between gap-2">
                      <div class="flex items-center gap-1">
                        <span class="text-sm font-semibold" :class="day.inMonth ? 'text-highlighted' : 'text-muted'">
                          {{ day.dayNumber }}
                        </span>
                        <UBadge
                          v-if="day.isToday"
                          color="primary"
                          variant="subtle"
                          size="xs"
                        >
                          今天
                        </UBadge>
                      </div>
                      <span v-if="day.totalHours > 0" class="text-xs font-semibold text-highlighted">
                        {{ day.totalHours.toFixed(1) }}h
                      </span>
                    </div>

                    <div class="mt-2 min-h-0 flex-1 space-y-1 overflow-hidden">
                      <div
                        v-for="group in day.projectGroups.slice(0, 3)"
                        :key="group.projectId"
                        class="rounded-md border border-default bg-default/80 px-2 py-1"
                      >
                        <div class="flex items-center justify-between gap-2">
                          <span class="truncate text-xs font-medium text-highlighted">
                            {{ group.projectName }}
                          </span>
                          <span class="shrink-0 text-xs font-semibold text-primary">
                            {{ group.hours.toFixed(1) }}h
                          </span>
                        </div>
                        <div v-if="group.entryCount > 0" class="mt-0.5 truncate font-mono text-[11px] text-muted">
                          {{ `${group.entryCount} 条工时` }}
                        </div>
                      </div>

                      <div v-if="day.projectGroups.length > 3" class="px-1 text-[11px] text-muted">
                        另有 {{ day.projectGroups.length - 3 }} 个项目
                      </div>
                    </div>

                    <UButton
                      v-if="day.inMonth && day.isPastOrToday && day.totalHours <= 0"
                      label="填报"
                      icon="i-lucide-plus"
                      color="primary"
                      variant="soft"
                      size="xs"
                      class="mt-2 justify-center"
                      :disabled="!canSubmitTimesheet"
                      :title="submitPermissionDenied ? SUBMIT_PERMISSION_DENIED_REASON : undefined"
                      @click.stop="openReportModal(day.dateKey)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      <UModal v-model:open="modalOpen" :title="`填报工时 · ${selectedDate}`" :ui="{ content: 'sm:max-w-3xl', body: 'p-0' }">
        <template #body>
          <div class="space-y-4 p-4">
            <UFormField label="填报方式">
              <div class="flex rounded-lg border border-default p-1">
                <UButton
                  class="flex-1 justify-center"
                  label="直接填工时"
                  icon="i-lucide-clock"
                  size="sm"
                  :color="form.mode === 'hours' ? 'primary' : 'neutral'"
                  :variant="form.mode === 'hours' ? 'soft' : 'ghost'"
                  @click="form.mode = 'hours'"
                />
                <UButton
                  class="flex-1 justify-center"
                  label="按百分比"
                  icon="i-lucide-percent"
                  size="sm"
                  :color="form.mode === 'percent' ? 'primary' : 'neutral'"
                  :variant="form.mode === 'percent' ? 'soft' : 'ghost'"
                  @click="form.mode = 'percent'"
                />
              </div>
            </UFormField>

            <UFormField label="项目工时" required>
              <template #hint>
                <span>{{ reportTotalHours.toFixed(1) }}h</span>
              </template>

              <div v-if="projectTimeRows.length === 0" class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted">
                暂无可填报项目
              </div>

              <div v-else class="max-h-[52vh] overflow-y-auto rounded-lg border border-default">
                <div
                  v-for="row in projectTimeRows"
                  :key="row.projectId"
                  class="grid gap-3 border-b border-default px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_13rem] md:items-center"
                >
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="truncate text-sm font-medium text-highlighted">
                        {{ rowProjectName(row.projectId) }}
                      </span>
                      <UBadge
                        v-if="rowProjectRoleLabel(row.projectId)"
                        :color="rowProjectRoleColor(row.projectId)"
                        variant="subtle"
                        size="xs"
                      >
                        {{ rowProjectRoleLabel(row.projectId) }}
                      </UBadge>
                    </div>
                    <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span class="font-mono">{{ rowProjectCode(row.projectId) }}</span>
                      <span v-if="row.existingHours > 0">已填 {{ row.existingHours.toFixed(1) }}h</span>
                    </div>
                  </div>

                  <div v-if="form.mode === 'hours'" class="flex items-center gap-2">
                    <UInput
                      v-model.number="row.hours"
                      type="number"
                      min="0"
                      max="24"
                      step="0.5"
                      class="min-w-0 flex-1"
                      placeholder="0"
                    />
                    <span class="w-8 shrink-0 text-sm text-muted">小时</span>
                  </div>

                  <div v-else class="grid grid-cols-[minmax(0,1fr)_4rem_4rem] items-center gap-2">
                    <UInput
                      v-model.number="row.percent"
                      type="number"
                      min="0"
                      max="100"
                      step="5"
                      class="min-w-0"
                      placeholder="0"
                    />
                    <span class="text-sm text-muted">%</span>
                    <span class="text-right text-sm font-medium text-highlighted">{{ rowSubmitHours(row).toFixed(1) }}h</span>
                  </div>
                </div>
              </div>

              <p class="mt-2 text-xs text-muted">
                百分比模式按每天 8 小时折算。合计：{{ reportTotalHours.toFixed(1) }}h<span v-if="form.mode === 'percent'"> / {{ reportTotalPercent.toFixed(0) }}%</span>。
              </p>
              <p v-if="reportTotalHours > 24" class="mt-1 text-xs text-warning">
                单日工时合计不能超过 24 小时。
              </p>
              <p v-if="form.mode === 'percent' && reportTotalPercent > 100" class="mt-1 text-xs text-warning">
                投入比例合计不能超过 100%。
              </p>
            </UFormField>

            <UFormField label="工作说明">
              <UTextarea
                v-model="form.description"
                class="w-full"
                placeholder="填写当天主要工作内容"
                :rows="3"
              />
            </UFormField>
          </div>
        </template>

        <template #footer="{ close }">
          <UButton
            label="取消"
            color="neutral"
            variant="outline"
            @click="close"
          />
          <UButton
            label="保存草稿"
            icon="i-lucide-check"
            color="primary"
            :loading="submitting"
            :disabled="reportSubmitDisabled"
            @click="submitTimeEntry"
          />
        </template>
      </UModal>

      <UModal v-model:open="detailModalOpen" :title="`工时明细 · ${selectedDate}`" :ui="{ content: 'sm:max-w-3xl', body: 'p-0' }">
        <template #body>
          <div class="space-y-4 p-4">
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <UBadge color="primary" variant="subtle">
                {{ dayRead.data.value ? `${detailTotalHours.toFixed(1)}h` : '—' }}
              </UBadge>
              <UBadge color="neutral" variant="subtle">
                共 {{ dayTotal }} 条
              </UBadge>
              <UBadge v-if="changedDetailRows.length > 0" color="warning" variant="subtle">
                已修改 {{ changedDetailRows.length }} 条
              </UBadge>
            </div>

            <UAlert
              v-if="dayForbidden"
              color="warning"
              icon="i-lucide-shield-alert"
              title="无权查看当日工时"
              description="当前账号没有本人工时的查看或填报权限。"
            />
            <UAlert
              v-else-if="dayRead.error.value"
              color="error"
              title="当日工时加载失败"
              description="全天统计和编辑基线暂不可用，请重新加载。"
            />
            <UButton
              v-if="dayRead.error.value && !dayForbidden"
              label="重新加载"
              color="neutral"
              variant="outline"
              @click="loadDayEntries()"
            />
            <USkeleton v-if="dayLoading" class="h-32 w-full" />
            <div v-else-if="!dayRead.error.value && detailRows.length === 0" class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted">
              暂无工时记录
            </div>

            <div v-else class="max-h-[56vh] overflow-y-auto rounded-lg border border-default">
              <div
                v-for="row in detailRows"
                :key="row.key"
                class="grid gap-3 border-b border-default px-3 py-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_8rem_minmax(14rem,1fr)] lg:items-start"
              >
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-highlighted">
                    {{ row.projectName }}
                  </div>
                  <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span class="font-mono">{{ row.projectCode }}</span>
                    <span v-if="row.itemKey">{{ row.itemKey }}</span>
                    <UBadge :color="reviewStatusColor(row.reviewStatus)" variant="subtle" size="xs">
                      {{ reviewStatusLabel(row.reviewStatus) }}
                    </UBadge>
                  </div>
                  <div v-if="row.itemTitle" class="mt-1 truncate text-xs text-muted">
                    {{ row.itemTitle }}
                  </div>
                  <p v-if="row.returnReason" class="mt-1 text-xs text-error">
                    退回原因：{{ row.returnReason }}
                  </p>
                </div>

                <UFormField label="工时">
                  <UInput
                    v-model.number="row.hours"
                    type="number"
                    min="0"
                    max="24"
                    step="0.5"
                    class="w-full"
                    :disabled="!row.editable"
                  />
                </UFormField>

                <UFormField label="工作说明">
                  <UTextarea
                    v-model="row.description"
                    :rows="2"
                    class="w-full"
                    :disabled="!row.editable"
                  />
                </UFormField>
              </div>
            </div>

            <UPagination
              :sibling-count="0"
              size="xs"
              :page="detailPage"
              :total="dayTotal"
              :items-per-page="detailPageSize"
              :disabled="dayLoading || detailSubmitting"
              @update:page="changeDetailPage"
            />
            <UButton
              label="新增工时"
              color="neutral"
              variant="outline"
              :disabled="!canSubmitTimesheet || detailSubmitting || changedDetailRows.length > 0"
              :title="submitPermissionDenied ? SUBMIT_PERMISSION_DENIED_REASON : selectedWeekSubmittedCount > 0 ? '已提交工时保持待审核；新增记录作为草稿，需另行提交。' : undefined"
              @click="openReportFromDetail"
            />
            <p v-if="selectedWeekSubmittedCount > 0" class="text-xs text-muted">
              本周已提交记录不受影响；新增工时会保存为草稿，需另行提交。
            </p>
            <p v-if="detailTotalHours > 24" class="text-xs text-warning">
              单日工时合计不能超过 24 小时。
            </p>
          </div>
        </template>

        <template #footer="{ close }">
          <UButton
            label="关闭"
            color="neutral"
            variant="outline"
            @click="close"
          />
          <UButton
            label="保存修改"
            icon="i-lucide-save"
            color="primary"
            :loading="detailSubmitting"
            :disabled="detailSubmitDisabled"
            @click="submitDetailChanges"
          />
        </template>
      </UModal>

      <UModal v-model:open="weekSubmitModalOpen" title="提交周工时审核">
        <template #body>
          <div class="space-y-3 p-4 text-sm">
            <p class="text-highlighted">
              将提交 {{ selectedWeekRange.start }} 至 {{ selectedWeekRange.end }}（{{ selectedPeriodKey }}）的
              {{ selectedWeekEditableCount }} 条草稿或已退回工时。
            </p>
            <p class="text-muted">
              普通成员工时将按填报日期分派给当时负责的项目经理或代理。履行项目经理职责期间的本人项目工时，会在项目周报提交后锁定，并随公司周报汇总确认。
            </p>
            <p v-if="selectedWeekSubmittedCount > 0" class="text-warning">
              本周已有 {{ selectedWeekSubmittedCount }} 条工时处于待审核状态，本次不会重复提交。
            </p>
          </div>
        </template>
        <template #footer="{ close }">
          <UButton
            label="取消"
            color="neutral"
            variant="outline"
            @click="close"
          />
          <UButton
            label="确认提交"
            icon="i-lucide-send"
            color="primary"
            :loading="weekSubmitting"
            :disabled="!!weekSubmitDisabledReason || weekSubmitting"
            @click="submitSelectedWeek"
          />
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>

<style scoped>
.host-timesheet-grid.is-hosted {
  grid-template-rows: auto minmax(12rem, 30%) minmax(0, 1fr);
}

.host-timesheet-grid.is-hosted > .host-timesheet-header {
  grid-column: 1 / -1;
}

@container (min-width: 56rem) {
  .host-timesheet-grid.is-hosted {
    grid-template-columns: minmax(18rem, 19rem) minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }

  .host-timesheet-grid.is-hosted > aside {
    border-right: 1px solid var(--ui-border);
    border-bottom-width: 0;
  }
}
</style>
