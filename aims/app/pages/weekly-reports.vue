<script setup lang="ts">
import ContentPageHeader from '../../../foundation/app/components/ContentPageHeader.vue'
import { useAimsModule } from '../../layer/useAimsModule'
import { projectStatusConfig } from '../config/project'
import type { ProjectMember } from '../types/aims'
import { getDefaultWeeklyReportWeek } from '../composables/useWeeklyReportDefaultWeek'
import { useProjectStore } from '../stores/project'
import { useTimeEntryReadPage } from '../composables/useTimeEntryPage'
import { isWeeklySummaryPage } from '../utils/weeklyReportSummaryPage'
import { isoWeekDateRange, normalizeIsoWeekInput, shiftIsoWeek } from '../utils/isoWeek'
import CompanyWeeklySummaryPanel from '../components/CompanyWeeklySummaryPanel.vue'
import { aimsApiErrorCode, isWeeklyPeriodNotReady, weeklyReportingErrorMessage } from '../utils/weeklyReportingError'

// 同一份代码供独立应用与企业宿主使用：非宿主模式下 moduleUrl 原样返回路径。
const { moduleUrl, hosted } = useAimsModule()
definePageMeta({
  hostContentInset: false,
  layoutHeader: true,
  layoutHeaderTitle: '周报汇总',
  layoutHeaderProjectSwitcher: false
})

interface WeeklyReportWorkItem {
  planType: 'this_week' | 'next_week'
  moduleName: string
  sortOrder: number
  taskSummary: string
  ownerUid: string
  ownerName: string
  completionPercent: number | null
  incompleteReason: string
  workloadDays: number | null
}

interface WeeklyReportSummaryItem {
  projectId: number
  projectCode: string
  internalCode?: string
  projectName: string
  projectCategory?: string
  lifecycleStatus?: string
  deptCode?: string
  leaderUid?: string
  reportId?: number | null
  reportYear: number
  reportWeek: number
  weekStart: string
  weekEnd: string
  mainWork?: string
  overallProgress?: string
  departmentName?: string
  projectTypeName?: string
  projectManagerName?: string
  initiationStatus?: string
  currentStage?: string
  progressStatus?: string
  completionPercent?: number | null
  contractStatus?: string
  contractAmount?: number | null
  paymentStatus?: string
  cumulativeLaborCost?: number | null
  majorRisks?: string
  coordinationNeeds?: string
  remarks?: string
  status?: 'draft' | 'submitted' | 'returned' | 'reviewed' | 'frozen' | 'correction_draft' | 'missing'
  totalHours?: number
  previousTotalHours?: number
  actualHours?: number
  memberCount?: number
  workItems?: WeeklyReportWorkItem[]
}

interface OverviewRankRow {
  projectId: number
  name: string
  code: string
  value: number
  previousValue?: number
  delta?: number
}

interface DirectorWorkbenchItem {
  obligationId: number
  projectId: number
  responsibleUid: string
  responsibilityType: 'formal_manager' | 'acting_manager'
  dueStatus: 'pending' | 'draft' | 'submitted' | 'late' | 'returned' | 'reviewed' | 'frozen'
  late: boolean
  reportId: number | null
  reportStatus: WeeklyReportSummaryItem['status'] | null
}

interface ChartTooltipParam {
  marker?: string
  name?: string
  value?: number
  percent?: number
  data?: {
    code?: string
    value?: number
    previousValue?: number
    delta?: number
  }
}

const toast = useToast()
const runtimeConfig = useRuntimeConfig()
const projectStore = useProjectStore()
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()
const { setRefresh, clearRefresh } = usePageActions()
const defaultReportWeek = getDefaultWeeklyReportWeek()

const selectedYear = ref(defaultReportWeek.year)
const selectedWeek = ref(defaultReportWeek.week)
// 输入框只编辑草稿：停止输入后（或回车/失焦）才切换所选周并加载一次，
// 不会逐字符请求，也不会停留在未加载的中间周。
const yearInput = ref(String(defaultReportWeek.year))
const weekInput = ref(String(defaultReportWeek.week))
const page = ref(1)
const pageSize = 20
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const summaryRead = useTimeEntryReadPage(isWeeklySummaryPage<WeeklyReportSummaryItem>)
const listTotal = computed(() => summaryRead.data.value?.total || 0)
const loading = ref(false)
const periodGenerating = ref(false)
const directorWorkbenchLoading = ref(false)
const directorPeriodReady = ref(true)
// 生成被业务状态阻断时的说明（例如周报设置未配置），切换周或生成成功后清空。
const periodBlockedMessage = ref('')
const periodBlockedByConfiguration = ref(false)
const directorWorkbenchItems = ref<DirectorWorkbenchItem[]>([])
const reviewingAction = ref<'approve' | 'return' | 'approve_with_corrective_action' | null>(null)
const reviewComment = ref('')
const correctiveDueDate = ref('')
const correctionModalOpen = ref(false)
const correctionReason = ref('')
const correctionOpening = ref(false)
const companySummaryOpen = ref(false)
const membersLoading = ref(false)
const { users: accountUsers } = useAccountUsers({ pageSize: 1000 })
const { departments } = useAccountDepartments()
const items = ref<WeeklyReportSummaryItem[]>([])
const editing = ref<WeeklyReportSummaryItem | null>(null)
const projectMembers = ref<ProjectMember[]>([])
const workloadChartEl = shallowRef<HTMLElement | null>(null)
const memberChartEl = shallowRef<HTMLElement | null>(null)
const changeChartEl = shallowRef<HTMLElement | null>(null)
const cumulativeChartEl = shallowRef<HTMLElement | null>(null)
const editForm = reactive({
  projectId: 0,
  mainWork: '',
  overallProgress: '',
  progressStatus: '',
  completionPercent: null as number | null,
  paymentStatus: '',
  cumulativeLaborCost: null as number | null,
  majorRisks: '',
  coordinationNeeds: '',
  workItems: [] as WeeklyReportWorkItem[]
})
const workItemPlanTypeOptions = [
  { label: '本周工作', value: 'this_week' },
  { label: '下周计划', value: 'next_week' }
]
let chartGeneration = 0
let membersRequestSeq = 0
let workbenchRequestSeq = 0
let echartsApi: typeof import('echarts') | null = null
let workloadChart: ReturnType<typeof import('echarts').init> | null = null
let memberChart: ReturnType<typeof import('echarts').init> | null = null
let changeChart: ReturnType<typeof import('echarts').init> | null = null
let cumulativeChart: ReturnType<typeof import('echarts').init> | null = null

const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const user of accountUsers.value) {
    if (user.realName?.trim()) map.set(user.uid, user.realName.trim())
  }
  return map
})

const departmentNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const dept of departments.value?.flat || []) {
    if (dept.deptCode) map.set(dept.deptCode, dept.name)
  }
  return map
})

const projectMemberOptions = computed(() => {
  return projectMembers.value
    .filter(member => member.status === 'active')
    .map(member => ({
      label: memberName(member),
      value: member.uid
    }))
})

const filteredItems = computed(() => items.value)
const summaryStats = computed(() => summaryRead.data.value?.summary || { total: 0, filled: 0, currentDays: 0, actualDays: 0 })
const overviewStats = computed(() => summaryRead.data.value?.summary || { previousDays: 0, deltaDays: 0, memberSlots: 0, cumulativeLaborCost: 0 })
const workloadChartRows = computed(() => summaryRead.data.value?.charts.workload || [])
const memberChartRows = computed(() => summaryRead.data.value?.charts.members || [])
const changeChartRows = computed(() => summaryRead.data.value?.charts.change || [])
const cumulativeChartRows = computed(() => summaryRead.data.value?.charts.cost || [])

const canReviewWeeklyReports = computed(() => hasPermission('weekly_reports', 'review'))
const canConfigureWeeklyReports = computed(() => hasPermission('weekly_reports', 'configure'))
const weeklySettingsPath = computed(() => moduleUrl('/admin/weekly-reporting-settings'))
const periodKey = computed(() => `${selectedYear.value}-W${String(selectedWeek.value).padStart(2, '0')}`)
const directorWorkbenchMap = computed(() => new Map(directorWorkbenchItems.value.map(item => [item.projectId, item])))
const directorWorkbenchStats = computed(() => ({
  total: directorWorkbenchItems.value.length,
  awaitingReview: directorWorkbenchItems.value.filter(item => item.reportStatus === 'submitted').length,
  missing: directorWorkbenchItems.value.filter(item => item.dueStatus === 'pending' || item.dueStatus === 'draft' || item.dueStatus === 'returned').length,
  late: directorWorkbenchItems.value.filter(item => item.late).length,
  reviewed: directorWorkbenchItems.value.filter(item => item.dueStatus === 'reviewed' || item.dueStatus === 'frozen').length
}))

const weekLabel = computed(() => {
  const weekText = String(selectedWeek.value).padStart(2, '0')
  return `${selectedYear.value}年 第${weekText}周`
})
// 起止日期由所选 ISO 周直接推算（与 Runtime isoWeekRange 相同），切换周即更新，
// 不依赖上一周列表响应的 meta。
const weekRange = computed(() => isoWeekDateRange(selectedYear.value, selectedWeek.value))
const weekRangeLabel = computed(() => `${weekRange.value.start} ~ ${weekRange.value.end}`)

const exportHref = computed(() => {
  const base = String(runtimeConfig.app.baseURL || '/').replace(/\/?$/, '/')
  return `${base}api/v1/weekly-reports/export?year=${selectedYear.value}&week=${selectedWeek.value}`
})

async function loadReports() {
  chartGeneration++
  loading.value = true
  items.value = []
  editing.value = null
  projectMembers.value = []
  const data = await summaryRead.read(moduleUrl('/api/v1/weekly-reports'), {
    year: selectedYear.value, week: selectedWeek.value, page: page.value, pageSize,
    includeWorkItems: '1', search: debounced.value || undefined
  })
  if (data) {
    items.value = data.items
    await nextTick()
    await renderOverviewCharts()
    await loadDirectorWorkbench()
  }
  loading.value = summaryRead.loading.value
}

async function loadDirectorWorkbench() {
  // Multiple report reads can settle during one week transition. Keep one
  // request for the same week and authorization fingerprint, including a
  // confirmed "period not ready" result; only transient failures may retry.
  const requestKey = `${periodKey.value}:${summaryRead.fingerprint.value}`
  if (directorWorkbenchLoadedKey === requestKey) return
  if (directorWorkbenchInFlight?.key === requestKey) return await directorWorkbenchInFlight.promise
  const promise = loadDirectorWorkbenchOnce()
  directorWorkbenchInFlight = { key: requestKey, promise }
  try {
    if (await promise) directorWorkbenchLoadedKey = requestKey
  } finally {
    if (directorWorkbenchInFlight?.promise === promise) directorWorkbenchInFlight = null
  }
}

let directorWorkbenchInFlight: { key: string, promise: Promise<boolean> } | null = null
let directorWorkbenchLoadedKey = ''
async function loadDirectorWorkbenchOnce(): Promise<boolean> {
  const sequence = ++workbenchRequestSeq
  const identity = summaryRead.fingerprint.value
  const key = periodKey.value
  if (!canReviewWeeklyReports.value) {
    directorWorkbenchItems.value = []
    return true
  }
  directorWorkbenchLoading.value = true
  try {
    const res = await $fetch<{ code: number, data: { items?: DirectorWorkbenchItem[] } }>(
      moduleUrl(`/api/v1/weekly-reporting-periods/${periodKey.value}/director-workbench`)
    )
    if (sequence !== workbenchRequestSeq || identity !== summaryRead.fingerprint.value || key !== periodKey.value) return false
    directorPeriodReady.value = true
    directorWorkbenchItems.value = res.data.items || []
    return true
  } catch (error: unknown) {
    if (sequence !== workbenchRequestSeq || identity !== summaryRead.fingerprint.value || key !== periodKey.value) return false
    directorWorkbenchItems.value = []
    // 周期不存在（409 weekly_reporting_period_required）表示本周应报清单未生成，
    // 提供生成入口；其余失败按业务码提示，不再把任意 409 当作“未生成”。
    if (isWeeklyPeriodNotReady(error)) {
      directorPeriodReady.value = false
      return true
    }
    console.error('[WeeklyReports] load director workbench failed:', error)
    toast.add({ title: weeklyReportingErrorMessage(error, '加载项目总监审阅责任清单失败'), color: 'error' })
    return false
  } finally {
    if (sequence === workbenchRequestSeq) directorWorkbenchLoading.value = false
  }
}

async function generateReportingPeriod() {
  if (!canReviewWeeklyReports.value) return
  periodGenerating.value = true
  periodBlockedMessage.value = ''
  periodBlockedByConfiguration.value = false
  try {
    await $fetch(moduleUrl(`/api/v1/weekly-reporting-periods/${periodKey.value}:generate`), {
      method: 'POST'
    })
    directorPeriodReady.value = true
    toast.add({ title: `${periodKey.value} 应报责任清单已生成`, color: 'success' })
    directorWorkbenchLoadedKey = ''
    await loadReports()
  } catch (error: unknown) {
    console.error('[WeeklyReports] generate reporting period failed:', error)
    const message = weeklyReportingErrorMessage(error, '生成应报责任清单失败')
    const code = aimsApiErrorCode(error)
    if (code === 'weekly_reporting_not_configured' || code === 'weekly_reporting_disabled') {
      periodBlockedMessage.value = message
      periodBlockedByConfiguration.value = true
    }
    toast.add({ title: message, color: 'error' })
  } finally {
    periodGenerating.value = false
  }
}

function dueStatusLabel(status: DirectorWorkbenchItem['dueStatus']) {
  if (status === 'submitted') return '待审'
  if (status === 'late') return '迟交待审'
  if (status === 'returned') return '已退回'
  if (status === 'reviewed') return '已审阅'
  if (status === 'frozen') return '已汇总'
  if (status === 'draft') return '草稿'
  return '未提交'
}

function dueStatusColor(status: DirectorWorkbenchItem['dueStatus']): 'neutral' | 'warning' | 'error' | 'success' | 'info' {
  if (status === 'submitted') return 'info'
  if (status === 'late' || status === 'returned') return 'error'
  if (status === 'reviewed' || status === 'frozen') return 'success'
  if (status === 'draft') return 'neutral'
  return 'warning'
}

function selectItem(item: WeeklyReportSummaryItem) {
  disposeOverviewCharts()
  editing.value = item
  reviewComment.value = ''
  correctiveDueDate.value = ''
  projectMembers.value = []
  editForm.projectId = item.projectId
  editForm.mainWork = item.mainWork || ''
  editForm.overallProgress = item.overallProgress || ''
  editForm.progressStatus = item.progressStatus || ''
  editForm.completionPercent = item.completionPercent ?? null
  editForm.paymentStatus = item.paymentStatus || ''
  editForm.cumulativeLaborCost = item.cumulativeLaborCost ?? null
  editForm.majorRisks = item.majorRisks || ''
  editForm.coordinationNeeds = item.coordinationNeeds || ''
  editForm.workItems = item.workItems?.length
    ? item.workItems.map((workItem, index) => ({
        ...workItem,
        sortOrder: workItem.sortOrder || index + 1
      }))
    : [newWorkItem()]
  void loadProjectMembers(item.projectId)
}

function showOverview() {
  membersRequestSeq++
  editing.value = null
  projectMembers.value = []
  nextTick(() => {
    renderOverviewCharts()
  })
}

async function reviewEditing(action: 'approve' | 'return' | 'approve_with_corrective_action') {
  if (!editing.value?.reportId || editing.value.status !== 'submitted') return
  if (!canReviewWeeklyReports.value) {
    toast.add({ title: '仅当前项目总监可以审阅项目周报', color: 'warning' })
    return
  }
  if (action !== 'approve' && !reviewComment.value.trim()) {
    toast.add({ title: '退回或带整改通过时必须填写审阅意见', color: 'warning' })
    return
  }
  reviewingAction.value = action
  try {
    const res = await $fetch<{ code: number }>(moduleUrl(`/api/v1/weekly-reports/${editing.value.reportId}:review`), {
      method: 'POST',
      body: {
        action,
        comment: reviewComment.value.trim() || undefined,
        correctiveDueDate: correctiveDueDate.value || undefined
      }
    })
    if (res.code === 0) {
      const title = action === 'return'
        ? '周报已退回项目经理修改'
        : action === 'approve_with_corrective_action'
          ? '周报已通过，并已创建整改工作项'
          : '周报已审阅通过'
      toast.add({ title, color: 'success' })
      reviewComment.value = ''
      correctiveDueDate.value = ''
      await loadReports()
    }
  } catch (error) {
    console.error('[WeeklyReports] review failed:', error)
    toast.add({ title: '审阅周报失败', color: 'error' })
  } finally {
    reviewingAction.value = null
  }
}

async function openCorrectionDraft() {
  if (!editing.value?.reportId || editing.value.status !== 'frozen' || !correctionReason.value.trim()) return
  correctionOpening.value = true
  try {
    await $fetch(moduleUrl(`/api/v1/weekly-reports/${editing.value.reportId}:open-correction`), {
      method: 'POST',
      body: { reason: correctionReason.value.trim() }
    })
    correctionModalOpen.value = false
    correctionReason.value = ''
    toast.add({ title: '已允许项目经理创建更正版周报', color: 'success' })
    await loadReports()
  } catch (error: unknown) {
    console.error('[WeeklyReports] open correction failed:', error)
    const message = (error as { data?: { message?: string } })?.data?.message || '发起更正版失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    correctionOpening.value = false
  }
}

async function loadProjectMembers(projectId: number) {
  const requestSeq = ++membersRequestSeq
  membersLoading.value = true
  try {
    const members = await projectStore.fetchMembers(projectId)
    if (requestSeq !== membersRequestSeq || editing.value?.projectId !== projectId) return
    projectMembers.value = members
  } catch (error) {
    if (requestSeq !== membersRequestSeq) return
    console.error('[WeeklyReports] load project members failed:', error)
    projectMembers.value = []
    toast.add({ title: '加载项目成员失败', color: 'error' })
  } finally {
    if (requestSeq === membersRequestSeq) membersLoading.value = false
  }
}

function selectWeek(year: number, week: number) {
  yearInput.value = String(year)
  weekInput.value = String(week)
  // The [selectedYear, selectedWeek] watcher resets paging and loads once.
  selectedYear.value = year
  selectedWeek.value = week
}

function prevWeek() {
  const target = shiftIsoWeek(selectedYear.value, selectedWeek.value, -1)
  selectWeek(target.year, target.week)
}

function nextWeek() {
  const target = shiftIsoWeek(selectedYear.value, selectedWeek.value, 1)
  selectWeek(target.year, target.week)
}

function applyWeekInput() {
  const target = normalizeIsoWeekInput(yearInput.value, weekInput.value)
  if (target) selectWeek(target.year, target.week)
}

function commitWeekInput() {
  // Blur/Enter: apply a valid draft now; an invalid one reverts to the current week.
  const target = normalizeIsoWeekInput(yearInput.value, weekInput.value)
  if (target) selectWeek(target.year, target.week)
  else selectWeek(selectedYear.value, selectedWeek.value)
}

function newWorkItem(): WeeklyReportWorkItem {
  return {
    planType: 'this_week',
    moduleName: '',
    sortOrder: editForm.workItems.length + 1,
    taskSummary: '',
    ownerUid: '',
    ownerName: '',
    completionPercent: null,
    incompleteReason: '',
    workloadDays: null
  }
}

function addWorkItem() {
  editForm.workItems.push(newWorkItem())
}

function removeWorkItem(index: number) {
  editForm.workItems.splice(index, 1)
  if (editForm.workItems.length === 0) editForm.workItems.push(newWorkItem())
}

function setWorkItemOwner(item: WeeklyReportWorkItem, uid: string) {
  item.ownerUid = uid
  item.ownerName = ownerNameForUid(uid)
}

function hoursToDays(hours: unknown) {
  return Number(hours || 0) / 8
}

function round2(value: number) {
  return Math.round(Number(value || 0) * 100) / 100
}

function formatCost(value: number) {
  return Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDays(value: number) {
  return `${round2(value)} 人天`
}

function formatSignedDays(value: number) {
  const rounded = round2(value)
  if (rounded > 0) return `+${rounded} 人天`
  if (rounded < 0) return `${rounded} 人天`
  return '0 人天'
}

function memberName(member: ProjectMember) {
  return member.realName || userNameMap.value.get(member.uid) || member.uid
}

function ownerNameForUid(uid: string) {
  if (!uid) return ''
  const member = projectMembers.value.find(member => member.uid === uid)
  return member ? memberName(member) : (userNameMap.value.get(uid) || uid)
}

function displayDepartmentName(item: WeeklyReportSummaryItem) {
  const rawName = String(item.departmentName || '').trim()
  const deptCode = String(item.deptCode || '').trim()
  if (rawName && rawName !== deptCode) return rawName
  if (deptCode) return departmentNameMap.value.get(deptCode) || deptCode
  return '-'
}

function displayProjectLeaderName(item: WeeklyReportSummaryItem) {
  const rawName = String(item.projectManagerName || '').trim()
  const leaderUid = String(item.leaderUid || '').trim()
  if (rawName && rawName !== leaderUid) return rawName
  if (leaderUid) return userNameMap.value.get(leaderUid) || leaderUid
  return '-'
}

function displayCurrentStage(item: WeeklyReportSummaryItem) {
  const stage = String(item.currentStage || item.lifecycleStatus || '').trim()
  return projectStatusConfig[stage as keyof typeof projectStatusConfig]?.label || stage || '-'
}

function statusLabel(status: string | undefined) {
  if (status === 'submitted') return '已提交'
  if (status === 'draft') return '草稿'
  if (status === 'returned') return '已退回'
  if (status === 'reviewed') return '已审阅'
  if (status === 'frozen') return '已汇总锁定'
  if (status === 'correction_draft') return '更正草稿'
  return '未填报'
}

function statusColor(status: string | undefined) {
  if (status === 'submitted') return 'info'
  if (status === 'reviewed' || status === 'frozen') return 'success'
  if (status === 'returned' || status === 'correction_draft') return 'warning'
  if (status === 'draft') return 'neutral'
  return 'warning'
}

function chartRows(rows: OverviewRankRow[], limit = 14) {
  return rows.slice(0, limit)
}

function pieRows(rows: OverviewRankRow[], limit = 10) {
  if (rows.some(row => row.projectId === 0)) return rows
  const topRows = rows.slice(0, limit)
  const restRows = rows.slice(limit)
  const restValue = restRows.reduce((sum, row) => sum + Number(row.value || 0), 0)
  if (restValue <= 0) return topRows
  return [
    ...topRows,
    {
      projectId: 0,
      name: '其他项目',
      code: `${restRows.length} 个项目`,
      value: round2(restValue)
    }
  ]
}

function tooltipHtml(params: ChartTooltipParam[] | ChartTooltipParam, unit: string) {
  const list = Array.isArray(params) ? params : [params]
  const param = list[0]
  if (!param) return ''
  const data = param.data || {}
  const value = Number(data.value ?? param.value ?? 0)
  const previous = data.previousValue
  const delta = data.delta
  const lines = [
    `<div style="font-weight:600;margin-bottom:4px;">${param.name || ''}</div>`,
    `<div style="color:#71717a;margin-bottom:2px;">${data.code || ''}</div>`,
    `<div>${param.marker || ''}数值：${unit === '成本' ? formatCost(value) : round2(value)} ${unit}</div>`
  ]
  if (previous !== undefined) {
    lines.push(`<div>上周：${round2(Number(previous))} ${unit}</div>`)
  }
  if (delta !== undefined) {
    lines.push(`<div>变化：${formatSignedDays(Number(delta))}</div>`)
  }
  return lines.join('')
}

function pieTooltipHtml(params: ChartTooltipParam) {
  const data = params.data || {}
  const value = Number(data.value ?? params.value ?? 0)
  const percent = Number(params.percent || 0)
  return [
    `<div style="font-weight:600;margin-bottom:4px;">${params.name || ''}</div>`,
    `<div style="color:#71717a;margin-bottom:2px;">${data.code || ''}</div>`,
    `<div>${params.marker || ''}投入：${round2(value)} 人天</div>`,
    `<div>占比：${percent.toFixed(1)}%</div>`
  ].join('')
}

function workloadPieOption(rows: OverviewRankRow[]) {
  const data = pieRows(rows)
  return {
    animationDuration: 450,
    color: ['#2563eb', '#f97316', '#16a34a', '#7c3aed', '#0891b2', '#eab308', '#dc2626', '#475569', '#db2777', '#65a30d', '#a1a1aa'],
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (params: ChartTooltipParam) => pieTooltipHtml(params)
    },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 8,
      top: 24,
      bottom: 16,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: {
        color: '#52525b',
        width: 116,
        overflow: 'truncate'
      }
    },
    series: [
      {
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['38%', '52%'],
        avoidLabelOverlap: true,
        minAngle: 4,
        data: data.map(row => ({
          name: row.name,
          value: row.value,
          code: row.code
        })),
        label: {
          show: true,
          color: '#3f3f46',
          fontSize: 11,
          lineHeight: 15,
          formatter: (params: ChartTooltipParam) => `${params.name || ''}\n${Number(params.percent || 0).toFixed(1)}%`
        },
        labelLine: {
          length: 10,
          length2: 8,
          lineStyle: {
            color: '#a1a1aa'
          }
        },
        itemStyle: {
          borderColor: '#ffffff',
          borderWidth: 2
        },
        emphasis: {
          scaleSize: 4,
          label: {
            fontWeight: 600
          }
        }
      }
    ]
  }
}

function rankBarOption(rows: OverviewRankRow[], unit: string, color: string) {
  const data = chartRows(rows)
  return {
    animationDuration: 450,
    grid: { left: 8, right: 40, top: 12, bottom: 16, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: { type: 'shadow' },
      formatter: (params: ChartTooltipParam[] | ChartTooltipParam) => tooltipHtml(params, unit)
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: '#71717a' },
      splitLine: { lineStyle: { color: '#e4e4e7' } }
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: data.map(row => row.name),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: {
        color: '#52525b',
        width: 112,
        overflow: 'truncate'
      }
    },
    series: [
      {
        type: 'bar',
        data: data.map(row => ({
          value: row.value,
          code: row.code
        })),
        barMaxWidth: 14,
        itemStyle: {
          color,
          borderRadius: [0, 5, 5, 0]
        },
        label: {
          show: true,
          position: 'right',
          color: '#52525b',
          fontSize: 11,
          formatter: (params: ChartTooltipParam) => unit === '成本' ? formatCost(Number(params.value || 0)) : `${round2(Number(params.value || 0))}`
        }
      }
    ]
  }
}

function changeBarOption(rows: OverviewRankRow[]) {
  const data = chartRows(rows)
  return {
    animationDuration: 450,
    grid: { left: 8, right: 44, top: 12, bottom: 18, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: { type: 'shadow' },
      formatter: (params: ChartTooltipParam[] | ChartTooltipParam) => tooltipHtml(params, '人天')
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: '#71717a' },
      splitLine: { lineStyle: { color: '#e4e4e7' } }
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: data.map(row => row.name),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: {
        color: '#52525b',
        width: 112,
        overflow: 'truncate'
      }
    },
    series: [
      {
        type: 'bar',
        data: data.map(row => ({
          value: row.value,
          previousValue: row.previousValue,
          delta: row.delta,
          code: row.code,
          itemStyle: {
            color: row.value > 0 ? '#f97316' : row.value < 0 ? '#16a34a' : '#94a3b8',
            borderRadius: row.value >= 0 ? [0, 5, 5, 0] : [5, 0, 0, 5]
          }
        })),
        barMaxWidth: 14,
        label: {
          show: true,
          position: 'right',
          color: '#52525b',
          fontSize: 11,
          formatter: (params: ChartTooltipParam) => formatSignedDays(Number(params.value || 0)).replace(' 人天', '')
        }
      }
    ]
  }
}

async function ensureEcharts() {
  if (!import.meta.client) return null
  if (!echartsApi) {
    echartsApi = await import('echarts')
  }
  return echartsApi
}

async function renderChart(
  chartEl: HTMLElement | null,
  currentChart: ReturnType<typeof import('echarts').init> | null,
  option: Record<string, unknown>
) {
  if (!chartEl) {
    currentChart?.dispose()
    return null
  }
  const generation = chartGeneration
  const identity = summaryRead.fingerprint.value
  const api = await ensureEcharts()
  if (generation !== chartGeneration || identity !== summaryRead.fingerprint.value) return currentChart
  if (!api) return currentChart
  let chart = currentChart
  if (chart && chart.getDom() !== chartEl) {
    chart.dispose()
    chart = null
  }
  chart = chart || api.init(chartEl, undefined, { renderer: 'svg' })
  chart.setOption(option, true)
  return chart
}

async function renderOverviewCharts() {
  if (editing.value) return
  const generation = chartGeneration
  workloadChart = await renderChart(workloadChartEl.value, workloadChart, workloadPieOption(workloadChartRows.value))
  if (generation !== chartGeneration) return
  memberChart = await renderChart(memberChartEl.value, memberChart, rankBarOption(memberChartRows.value, '人', '#0891b2'))
  if (generation !== chartGeneration) return
  changeChart = await renderChart(changeChartEl.value, changeChart, changeBarOption(changeChartRows.value))
  if (generation !== chartGeneration) return
  cumulativeChart = await renderChart(cumulativeChartEl.value, cumulativeChart, rankBarOption(cumulativeChartRows.value, '成本', '#7c3aed'))
}

function disposeOverviewCharts() {
  chartGeneration++
  for (const chart of [workloadChart, memberChart, changeChart, cumulativeChart]) {
    chart?.dispose()
  }
  workloadChart = null
  memberChart = null
  changeChart = null
  cumulativeChart = null
}

watch([debounced, page], () => {
  loadReports()
})
watch([selectedYear, selectedWeek], () => {
  directorWorkbenchLoadedKey = ''
  summaryRead.clear()
  items.value = []
  editing.value = null
  periodBlockedMessage.value = ''
  periodBlockedByConfiguration.value = false
  // Every week change loads exactly once: resetting a later page triggers the
  // page watcher, otherwise load here.
  if (page.value !== 1) page.value = 1
  else loadReports()
})
watchDebounced([yearInput, weekInput], () => {
  // Arrow navigation mirrors the selected week into both inputs. This is not
  // another user edit and must not replay the same week transition.
  if (String(yearInput.value) === String(selectedYear.value) && String(weekInput.value) === String(selectedWeek.value)) return
  applyWeekInput()
}, { debounce: 600 })
watch(summaryRead.fingerprint, () => {
  items.value = []
  editing.value = null
  projectMembers.value = []
  workbenchRequestSeq++
  directorWorkbenchLoading.value = false
  directorWorkbenchItems.value = []
  disposeOverviewCharts()
}, { flush: 'sync' })

watch([workloadChartRows, memberChartRows, changeChartRows, cumulativeChartRows, editing], () => {
  if (editing.value) return
  nextTick(() => {
    renderOverviewCharts()
  })
}, { deep: true })

useResizeObserver(workloadChartEl, () => workloadChart?.resize())
useResizeObserver(memberChartEl, () => memberChart?.resize())
useResizeObserver(changeChartEl, () => changeChart?.resize())
useResizeObserver(cumulativeChartEl, () => cumulativeChart?.resize())

onMounted(async () => {
  setRefresh(loadReports)
  if (!permissionsLoaded.value) {
    await loadPermissions()
  }
  await loadReports()
})

onBeforeUnmount(() => {
  clearRefresh()
  disposeOverviewCharts()
})
</script>

<template>
  <UDashboardPanel id="weekly-reports-summary" :ui="{ body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex h-full min-h-0 flex-col weekly-reports-container" style="container-type: inline-size">
        <div v-if="hosted" class="shrink-0 border-b border-default px-4 py-4 sm:px-6">
          <ContentPageHeader
            :hosted="hosted"
            title="周报汇总"
            :description="`${weekLabel}（${weekRangeLabel}）`"
            breadcrumb="交付与服务 / 执行协同"
          >
            <template #actions>
              <UButton
                icon="i-lucide-chevron-left"
                variant="outline"
                color="neutral"
                @click="prevWeek"
              />
              <UInput
                v-model="yearInput"
                type="number"
                aria-label="年份"
                class="w-24"
                @keyup.enter="commitWeekInput"
                @blur="commitWeekInput"
              />
              <UInput
                v-model="weekInput"
                type="number"
                min="1"
                max="53"
                aria-label="周次"
                class="w-20"
                @keyup.enter="commitWeekInput"
                @blur="commitWeekInput"
              />
              <UButton
                icon="i-lucide-chevron-right"
                variant="outline"
                color="neutral"
                @click="nextWeek"
              />
              <UButton
                v-if="canReviewWeeklyReports && !directorPeriodReady"
                icon="i-lucide-calendar-plus"
                label="生成应报清单"
                color="warning"
                variant="soft"
                :loading="periodGenerating"
                @click="generateReportingPeriod"
              />
              <UButton
                v-if="canReviewWeeklyReports && directorPeriodReady"
                icon="i-lucide-files"
                label="公司汇总"
                color="primary"
                variant="soft"
                @click="companySummaryOpen = true"
              />
              <UButton
                icon="i-lucide-download"
                label="导出汇总表"
                color="primary"
                :to="exportHref"
                external
              />
            </template>
          </ContentPageHeader>
        </div>
        <div v-else class="shrink-0 border-b border-default bg-default px-6 py-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 class="text-xl font-semibold text-highlighted">
                项目周报汇总
              </h1>
              <p class="text-sm text-muted">
                {{ weekLabel }} <span data-testid="weekly-report-week-range">({{ weekRangeLabel }})</span>
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <UButton
                icon="i-lucide-chevron-left"
                variant="outline"
                color="neutral"
                @click="prevWeek"
              />
              <UInput
                v-model="yearInput"
                type="number"
                aria-label="年份"
                class="w-24"
                @keyup.enter="commitWeekInput"
                @blur="commitWeekInput"
              />
              <UInput
                v-model="weekInput"
                type="number"
                min="1"
                max="53"
                aria-label="周次"
                class="w-20"
                @keyup.enter="commitWeekInput"
                @blur="commitWeekInput"
              />
              <UButton
                icon="i-lucide-chevron-right"
                variant="outline"
                color="neutral"
                @click="nextWeek"
              />
              <UButton
                v-if="canReviewWeeklyReports && !directorPeriodReady"
                icon="i-lucide-calendar-plus"
                label="生成应报清单"
                color="warning"
                variant="soft"
                :loading="periodGenerating"
                @click="generateReportingPeriod"
              />
              <UButton
                v-if="canReviewWeeklyReports && directorPeriodReady"
                icon="i-lucide-files"
                label="公司汇总"
                color="primary"
                variant="soft"
                @click="companySummaryOpen = true"
              />
              <UButton
                icon="i-lucide-download"
                label="导出汇总表"
                color="primary"
                :to="exportHref"
                external
              />
            </div>
          </div>
        </div>

        <div
          class="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] weekly-reports-grid"
          :class="hosted ? 'is-hosted' : ''"
        >
          <aside
            class="flex min-h-0 flex-col border-b border-default bg-default/80 xl:border-r xl:border-b-0"
          >
            <div class="border-b border-default px-4 py-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-highlighted">
                    项目列表
                  </p>
                  <p class="text-xs text-muted">
                    {{ summaryStats.filled }} / {{ summaryStats.total }} 个项目
                  </p>
                </div>
                <UButton
                  icon="i-lucide-chart-column"
                  label="总览"
                  size="xs"
                  :color="editing ? 'neutral' : 'primary'"
                  variant="soft"
                  @click="showOverview"
                />
              </div>

              <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div class="rounded-lg border border-default bg-default p-2">
                  <div class="text-muted">
                    本周人天
                  </div>
                  <div class="mt-0.5 text-base font-semibold text-highlighted">
                    {{ summaryStats.currentDays }}
                  </div>
                </div>
                <div class="rounded-lg border border-default bg-default p-2">
                  <div class="text-muted">
                    成员填报
                  </div>
                  <div class="mt-0.5 text-base font-semibold text-highlighted">
                    {{ summaryStats.actualDays }}
                  </div>
                </div>
              </div>

              <UInput
                v-model="search"
                icon="i-lucide-search"
                placeholder="搜索项目名/编码、周报部门/负责人快照、UID"
                class="mt-3 w-full"
                @keydown.enter="flush"
              />
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto p-3">
              <div v-if="loading" class="space-y-2">
                <USkeleton v-for="index in 6" :key="index" class="h-20 rounded-lg" />
              </div>

              <UAlert
                v-else-if="summaryRead.error.value && summaryRead.errorStatus.value === 403"
                color="warning"
                icon="i-lucide-shield-alert"
                title="无权查看周报汇总"
                description="当前账号没有周报查看权限，请联系管理员开通。"
              />
              <UAlert
                v-else-if="summaryRead.error.value"
                color="error"
                title="加载周报汇总失败"
                description="请重试；统计与图表不会使用旧数据。"
              >
                <template #actions>
                  <UButton label="重试" @click="loadReports" />
                </template>
              </UAlert>
              <div v-else-if="filteredItems.length === 0" class="rounded-lg border border-dashed border-default px-4 py-10 text-center text-sm text-muted">
                <UIcon name="i-lucide-folder-open" class="mx-auto mb-2 size-8" />
                暂无周报项目
              </div>

              <div v-else class="space-y-2">
                <button
                  v-for="item in filteredItems"
                  :key="item.projectId"
                  type="button"
                  class="w-full rounded-lg border p-2 text-left transition hover:bg-elevated"
                  :class="editing?.projectId === item.projectId ? 'border-primary bg-primary/10' : 'border-default bg-default'"
                  @click="selectItem(item)"
                >
                  <div class="flex items-start justify-between gap-1">
                    <div class="min-w-0">
                      <div class="truncate text-sm font-medium text-highlighted">
                        {{ item.projectName }}
                      </div>
                      <div class="mt-1 truncate font-mono text-xs text-muted">
                        {{ item.internalCode || item.projectCode }}
                        <span class="pl-2 truncate">{{ displayCurrentStage(item) }}</span>
                      </div>
                    </div>
                    <UBadge :color="statusColor(item.status)" variant="subtle" size="xs">
                      {{ statusLabel(item.status) }}
                    </UBadge>
                  </div>
                  <div
                    v-if="directorWorkbenchMap.get(item.projectId)"
                    class="mt-2 flex flex-wrap items-center gap-1"
                  >
                    <UBadge
                      :color="dueStatusColor(directorWorkbenchMap.get(item.projectId)!.dueStatus)"
                      variant="subtle"
                      size="xs"
                    >
                      责任清单：{{ dueStatusLabel(directorWorkbenchMap.get(item.projectId)!.dueStatus) }}
                    </UBadge>
                    <UBadge
                      v-if="directorWorkbenchMap.get(item.projectId)!.responsibilityType === 'acting_manager'"
                      color="warning"
                      variant="outline"
                      size="xs"
                    >
                      代理项目经理
                    </UBadge>
                  </div>

                  <div class="mt-1 flex min-w-0 items-center gap-2 truncate text-xs text-muted">
                    <span class="shrink-0">{{ displayDepartmentName(item) }}</span>
                    <span class="truncate">· {{ displayProjectLeaderName(item) }}</span>
                  </div>

                  <div class="mt-1 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span class="text-muted">
                        本周人天:
                      </span>
                      <span class="mt-0.5 font-semibold text-highlighted">
                        {{ round2(hoursToDays(item.totalHours)) }}
                      </span>
                    </div>
                    <div>
                      <span class="text-muted">
                        成员填报:
                      </span>
                      <span class="mt-0.5 font-semibold text-highlighted">
                        {{ round2(hoursToDays(item.actualHours)) }}
                      </span>
                    </div>
                  </div>
                </button>
              </div>
            </div>
            <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-default p-3">
              <span class="text-xs text-muted">共 {{ listTotal }} 条</span>
              <UPagination
                v-model:page="page"
                :items-per-page="pageSize"
                :total="listTotal"
                :sibling-count="0"
              />
            </div>
          </aside>

          <main class="min-h-0 min-w-0 overflow-y-auto bg-elevated/20 p-4" style="container-type: inline-size">
            <div v-if="!editing" class="w-full space-y-4">
              <UAlert
                v-if="canReviewWeeklyReports && !directorPeriodReady"
                color="warning"
                variant="subtle"
                icon="i-lucide-calendar-x"
                title="本周尚未生成应报责任清单"
                :description="periodBlockedMessage || '先生成责任清单，系统才会冻结本周应报项目和项目经理/代理责任快照。'"
              >
                <template #actions>
                  <UButton
                    v-if="periodBlockedByConfiguration && canConfigureWeeklyReports"
                    label="前往周报设置"
                    icon="i-lucide-settings"
                    color="neutral"
                    variant="outline"
                    :to="weeklySettingsPath"
                  />
                  <UButton
                    label="生成应报清单"
                    color="warning"
                    variant="soft"
                    :loading="periodGenerating"
                    @click="generateReportingPeriod"
                  />
                </template>
              </UAlert>
              <section
                v-else-if="canReviewWeeklyReports"
                class="weekly-summary-metrics"
              >
                <div class="rounded-lg border border-default bg-default p-3">
                  <div class="text-xs text-muted">
                    应报项目
                  </div>
                  <div class="mt-1 text-xl font-semibold text-highlighted">
                    {{ directorWorkbenchStats.total }}
                  </div>
                </div>
                <div class="rounded-lg border border-info/30 bg-info/5 p-3">
                  <div class="text-xs text-muted">
                    待总监审阅
                  </div>
                  <div class="mt-1 text-xl font-semibold text-info">
                    {{ directorWorkbenchStats.awaitingReview }}
                  </div>
                </div>
                <div class="rounded-lg border border-warning/30 bg-warning/5 p-3">
                  <div class="text-xs text-muted">
                    未提交/退回
                  </div>
                  <div class="mt-1 text-xl font-semibold text-warning">
                    {{ directorWorkbenchStats.missing }}
                  </div>
                </div>
                <div class="rounded-lg border border-error/30 bg-error/5 p-3">
                  <div class="text-xs text-muted">
                    迟交
                  </div>
                  <div class="mt-1 text-xl font-semibold text-error">
                    {{ directorWorkbenchStats.late }}
                  </div>
                </div>
                <div class="rounded-lg border border-success/30 bg-success/5 p-3">
                  <div class="text-xs text-muted">
                    已审阅
                  </div>
                  <div class="mt-1 text-xl font-semibold text-success">
                    {{ directorWorkbenchStats.reviewed }}
                  </div>
                </div>
              </section>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <h2 class="text-lg font-semibold text-highlighted">
                    周报总览
                  </h2>
                  <p class="mt-1 text-xs text-muted">
                    {{ weekLabel }} <span data-testid="weekly-report-week-range">({{ weekRangeLabel }})</span>
                  </p>
                </div>
                <UBadge color="primary" variant="subtle" size="sm">
                  已填报 {{ summaryStats.filled }} / {{ summaryStats.total }}
                </UBadge>
              </div>

              <div class="weekly-summary-metrics">
                <div class="rounded-lg border border-default bg-default px-4 py-3">
                  <div class="flex items-center justify-between gap-2 text-xs text-muted">
                    <span>本周认定</span>
                    <UIcon name="i-lucide-activity" class="size-4" />
                  </div>
                  <div class="mt-2 text-xl font-semibold text-highlighted">
                    {{ formatDays(summaryStats.currentDays) }}
                  </div>
                </div>
                <div class="rounded-lg border border-default bg-default px-4 py-3">
                  <div class="flex items-center justify-between gap-2 text-xs text-muted">
                    <span>成员填报</span>
                    <UIcon name="i-lucide-clock-3" class="size-4" />
                  </div>
                  <div class="mt-2 text-xl font-semibold text-highlighted">
                    {{ formatDays(summaryStats.actualDays) }}
                  </div>
                </div>
                <div class="rounded-lg border border-default bg-default px-4 py-3">
                  <div class="flex items-center justify-between gap-2 text-xs text-muted">
                    <span>较上周</span>
                    <UIcon name="i-lucide-trending-up" class="size-4" />
                  </div>
                  <div
                    class="mt-2 text-xl font-semibold"
                    :class="overviewStats.deltaDays > 0 ? 'text-warning' : overviewStats.deltaDays < 0 ? 'text-success' : 'text-highlighted'"
                  >
                    {{ formatSignedDays(overviewStats.deltaDays) }}
                  </div>
                </div>
                <div class="rounded-lg border border-default bg-default px-4 py-3">
                  <div class="flex items-center justify-between gap-2 text-xs text-muted">
                    <span>参与人次</span>
                    <UIcon name="i-lucide-users" class="size-4" />
                  </div>
                  <div class="mt-2 text-xl font-semibold text-highlighted">
                    {{ overviewStats.memberSlots }}
                  </div>
                </div>
                <div class="rounded-lg border border-default bg-default px-4 py-3">
                  <div class="flex items-center justify-between gap-2 text-xs text-muted">
                    <span>累计人力成本</span>
                    <UIcon name="i-lucide-database" class="size-4" />
                  </div>
                  <div class="mt-2 text-xl font-semibold text-highlighted">
                    {{ formatCost(overviewStats.cumulativeLaborCost) }}
                  </div>
                </div>
              </div>

              <div class="weekly-summary-charts">
                <section class="rounded-lg border border-default bg-default p-4">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <h3 class="text-sm font-semibold text-highlighted">
                        项目人力投入分布
                      </h3>
                      <p class="mt-1 text-xs text-muted">
                        本周认定人天占比
                      </p>
                    </div>
                    <UBadge color="neutral" variant="subtle" size="xs">
                      占比
                    </UBadge>
                  </div>
                  <div
                    v-if="workloadChartRows.length"
                    ref="workloadChartEl"
                    class="weekly-chart-canvas mt-3 h-80 w-full"
                  />
                  <div v-else class="weekly-chart-canvas mt-3 flex h-80 items-center justify-center rounded-lg border border-dashed border-default text-sm text-muted">
                    暂无本周投入数据
                  </div>
                </section>

                <section class="rounded-lg border border-default bg-default p-4">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <h3 class="text-sm font-semibold text-highlighted">
                        项目人员占用数分布
                      </h3>
                      <p class="mt-1 text-xs text-muted">
                        按参与人员数量排序
                      </p>
                    </div>
                    <UBadge color="neutral" variant="subtle" size="xs">
                      Top {{ Math.min(memberChartRows.length, 14) }}
                    </UBadge>
                  </div>
                  <div
                    v-if="memberChartRows.length"
                    ref="memberChartEl"
                    class="weekly-chart-canvas mt-3 h-80 w-full"
                  />
                  <div v-else class="weekly-chart-canvas mt-3 flex h-80 items-center justify-center rounded-lg border border-dashed border-default text-sm text-muted">
                    暂无参与人员数据
                  </div>
                </section>

                <section class="rounded-lg border border-default bg-default p-4">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <h3 class="text-sm font-semibold text-highlighted">
                        项目人力投入变化情况
                      </h3>
                      <p class="mt-1 text-xs text-muted">
                        较上周变化，按波动幅度排序
                      </p>
                    </div>
                    <UBadge color="neutral" variant="subtle" size="xs">
                      Top {{ Math.min(changeChartRows.length, 14) }}
                    </UBadge>
                  </div>
                  <div
                    v-if="changeChartRows.length"
                    ref="changeChartEl"
                    class="weekly-chart-canvas mt-3 h-80 w-full"
                  />
                  <div v-else class="weekly-chart-canvas mt-3 flex h-80 items-center justify-center rounded-lg border border-dashed border-default text-sm text-muted">
                    暂无较上周变化数据
                  </div>
                </section>

                <section class="rounded-lg border border-default bg-default p-4">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <h3 class="text-sm font-semibold text-highlighted">
                        项目累计人力投入
                      </h3>
                      <p class="mt-1 text-xs text-muted">
                        按累计人力成本排序
                      </p>
                    </div>
                    <UBadge color="neutral" variant="subtle" size="xs">
                      Top {{ Math.min(cumulativeChartRows.length, 14) }}
                    </UBadge>
                  </div>
                  <div
                    v-if="cumulativeChartRows.length"
                    ref="cumulativeChartEl"
                    class="weekly-chart-canvas mt-3 h-80 w-full"
                  />
                  <div v-else class="weekly-chart-canvas mt-3 flex h-80 items-center justify-center rounded-lg border border-dashed border-default text-sm text-muted">
                    暂无累计人力成本数据
                  </div>
                </section>
              </div>
            </div>

            <div v-else class="mx-auto w-full max-w-[96rem] space-y-4">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <h2 class="truncate text-lg font-semibold text-highlighted">
                    {{ editing.projectName }}
                  </h2>
                  <p class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span class="font-mono">{{ editing.internalCode || editing.projectCode }}</span>
                    <UBadge :color="statusColor(editing.status)" variant="subtle" size="xs">
                      {{ statusLabel(editing.status) }}
                    </UBadge>
                  </p>
                </div>
              </div>

              <UAlert
                v-if="editing.status !== 'submitted'"
                :color="editing.status === 'reviewed' || editing.status === 'frozen' ? 'success' : 'neutral'"
                variant="subtle"
                icon="i-lucide-shield-check"
                :title="editing.status === 'reviewed' || editing.status === 'frozen' ? '该版本已经项目总监审阅' : '当前周报不在待审状态'"
                description="项目总监只能审阅或退回，不能修改项目经理填写的周报正文。"
              />
              <section
                v-if="editing.status === 'frozen' && canReviewWeeklyReports"
                class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default bg-default p-4"
              >
                <div>
                  <h3 class="text-sm font-semibold text-highlighted">
                    已发布版本更正
                  </h3>
                  <p class="mt-1 text-xs text-muted">
                    原版本永久保留。发起后，项目经理将基于已发布版本创建新的更正草稿。
                  </p>
                </div>
                <UButton
                  label="发起更正版"
                  icon="i-lucide-file-pen-line"
                  color="warning"
                  variant="soft"
                  @click="correctionModalOpen = true"
                />
              </section>
              <section
                v-else-if="canReviewWeeklyReports"
                class="rounded-lg border border-default bg-default p-4"
              >
                <div class="flex items-start gap-3">
                  <UIcon name="i-lucide-clipboard-check" class="mt-0.5 size-5 text-primary" />
                  <div class="min-w-0 flex-1">
                    <h3 class="text-sm font-semibold text-highlighted">
                      项目总监审阅
                    </h3>
                    <p class="mt-1 text-xs text-muted">
                      退回后项目经理可修改并重新提交；通过后等待公司周报汇总锁定。
                    </p>
                    <UTextarea
                      v-model="reviewComment"
                      class="mt-3 w-full"
                      :rows="3"
                      placeholder="审阅意见（退回或带整改通过时必填）"
                    />
                    <div class="mt-3 flex flex-wrap items-end gap-2">
                      <UFormField label="整改截止日（可选）" class="w-48">
                        <UInput v-model="correctiveDueDate" type="date" class="w-full" />
                      </UFormField>
                      <UButton
                        icon="i-lucide-rotate-ccw"
                        label="退回修改"
                        color="warning"
                        variant="soft"
                        :loading="reviewingAction === 'return'"
                        :disabled="Boolean(reviewingAction)"
                        @click="reviewEditing('return')"
                      />
                      <UButton
                        icon="i-lucide-list-checks"
                        label="通过并建整改项"
                        color="primary"
                        variant="soft"
                        :loading="reviewingAction === 'approve_with_corrective_action'"
                        :disabled="Boolean(reviewingAction)"
                        @click="reviewEditing('approve_with_corrective_action')"
                      />
                      <UButton
                        icon="i-lucide-check"
                        label="审阅通过"
                        color="success"
                        :loading="reviewingAction === 'approve'"
                        :disabled="Boolean(reviewingAction)"
                        @click="reviewEditing('approve')"
                      />
                    </div>
                  </div>
                </div>
              </section>

              <div class="grid gap-3">
                <div class="grid gap-3 lg:grid-cols-2">
                  <UFormField label="主要工作">
                    <UTextarea
                      v-model="editForm.mainWork"
                      :rows="7"
                      disabled
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField label="整体进展">
                    <UTextarea
                      v-model="editForm.overallProgress"
                      :rows="7"
                      disabled
                      class="w-full"
                    />
                  </UFormField>
                </div>
                <div class="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
                  <UFormField label="进度情况">
                    <UInput
                      v-model="editForm.progressStatus"
                      disabled
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField label="总体完成进度">
                    <UInput
                      v-model="editForm.completionPercent"
                      type="number"
                      min="0"
                      max="100"
                      disabled
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField label="回款情况">
                    <UInput
                      v-model="editForm.paymentStatus"
                      disabled
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField label="累计人力成本">
                    <UInput
                      :model-value="formatCost(editForm.cumulativeLaborCost || 0)"
                      type="text"
                      min="0"
                      disabled
                      class="w-full"
                    />
                  </UFormField>
                </div>
                <UFormField label="重大问题和风险">
                  <UTextarea
                    v-model="editForm.majorRisks"
                    :rows="3"
                    disabled
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="待协调资源">
                  <UTextarea
                    v-model="editForm.coordinationNeeds"
                    :rows="3"
                    disabled
                    class="w-full"
                  />
                </UFormField>
              </div>

              <div class="space-y-3 border-t border-default pt-4">
                <div class="flex items-center justify-between">
                  <h3 class="text-sm font-semibold text-highlighted">
                    工作项
                  </h3>
                  <UButton
                    v-if="false"
                    icon="i-lucide-plus"
                    label="新增"
                    size="xs"
                    variant="soft"
                    @click="addWorkItem"
                  />
                </div>
                <div
                  v-for="(item, index) in editForm.workItems"
                  :key="index"
                  class="space-y-2 rounded-lg border border-default p-3"
                >
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <USelect
                      v-model="item.planType"
                      :items="workItemPlanTypeOptions"
                      disabled
                      class="w-32"
                    />
                    <UButton
                      v-if="false"
                      icon="i-lucide-trash-2"
                      color="error"
                      variant="ghost"
                      size="xs"
                      @click="removeWorkItem(index)"
                    />
                  </div>
                  <div class="grid gap-2 lg:grid-cols-[16rem_minmax(0,1fr)]">
                    <USelect
                      :model-value="item.ownerUid || undefined"
                      :items="projectMemberOptions"
                      :loading="membersLoading"
                      disabled
                      placeholder="选择责任人"
                      class="w-full"
                      @update:model-value="value => setWorkItemOwner(item, String(value || ''))"
                    />
                    <UInput
                      v-model="item.moduleName"
                      disabled
                      placeholder="模块名称"
                      class="w-full"
                    />
                  </div>
                  <UTextarea
                    v-model="item.taskSummary"
                    :rows="2"
                    disabled
                    placeholder="任务简述"
                    class="w-full"
                  />
                  <div class="grid gap-2 md:grid-cols-[12rem_12rem_minmax(0,1fr)]">
                    <UInput
                      v-model="item.completionPercent"
                      type="number"
                      min="0"
                      max="100"
                      disabled
                      placeholder="完成度%"
                      class="w-full"
                    />
                    <UInput
                      v-model="item.workloadDays"
                      type="number"
                      min="0"
                      step="0.5"
                      disabled
                      placeholder="工作量(人日)"
                      class="w-full"
                    />
                    <UInput
                      v-model="item.incompleteReason"
                      disabled
                      placeholder="未完成说明"
                      class="w-full"
                    />
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>

        <UModal v-model:open="correctionModalOpen" title="发起项目周报更正版">
          <template #body>
            <div class="space-y-4 p-4">
              <p class="text-sm text-muted">
                更正不会覆盖已发布版本。项目经理重新提交后，仍需项目总监审阅并纳入后续更正汇总。
              </p>
              <UFormField label="更正原因" required>
                <UTextarea
                  v-model="correctionReason"
                  :rows="4"
                  class="w-full"
                  placeholder="说明需要更正的事实或内容"
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
              label="确认发起"
              icon="i-lucide-file-pen-line"
              color="warning"
              :loading="correctionOpening"
              :disabled="!correctionReason.trim()"
              @click="openCorrectionDraft"
            />
          </template>
        </UModal>
        <USlideover
          v-model:open="companySummaryOpen"
          title="公司项目周报汇总"
          :ui="{ content: 'w-screen max-w-6xl', body: 'flex min-h-0 p-0' }"
        >
          <template #body>
            <CompanyWeeklySummaryPanel
              :period-key="periodKey"
              :active="companySummaryOpen"
            />
          </template>
        </USlideover>
      </div>
    </template>
  </UDashboardPanel>
</template>

<style scoped>
.weekly-chart-canvas {
  height: 20rem;
  min-width: 0;
}

.weekly-summary-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.weekly-summary-charts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
}

@container (min-width: 40rem) {
  .weekly-summary-metrics {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  .weekly-summary-charts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.weekly-reports-grid.is-hosted {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

@container (min-width: 56rem) {
  .weekly-reports-grid.is-hosted {
    grid-template-columns: minmax(18rem, 22rem) minmax(0, 1fr);
  }

  .weekly-reports-grid.is-hosted > aside {
    border-right: 1px solid var(--ui-border);
    border-bottom-width: 0;
  }
}
</style>
