<script setup lang="ts">
import { projectStatusConfig } from '~/config/project'
import type { ProjectMember } from '~/types/aims'

definePageMeta({
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
  status?: 'draft' | 'submitted' | 'missing'
  totalHours?: number
  previousTotalHours?: number
  actualHours?: number
  memberCount?: number
  workItems?: WeeklyReportWorkItem[]
}

interface ListPayload<T> {
  items?: T[]
  meta?: {
    weekStart?: string
    weekEnd?: string
  }
}

interface OverviewRankRow {
  projectId: number
  name: string
  code: string
  value: number
  previousValue?: number
  delta?: number
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
const { loaded: permissionsLoaded, loadPermissions, hasPermission, hasRole } = usePermissions()
const defaultReportWeek = getDefaultWeeklyReportWeek()

const selectedYear = ref(defaultReportWeek.year)
const selectedWeek = ref(defaultReportWeek.week)
const search = ref('')
const loading = ref(false)
const saving = ref(false)
const membersLoading = ref(false)
const { users: accountUsers } = useAccountUsers({ pageSize: 1000 })
const { departments } = useAccountDepartments()
const items = ref<WeeklyReportSummaryItem[]>([])
const weekStart = ref('')
const weekEnd = ref('')
const editing = ref<WeeklyReportSummaryItem | null>(null)
const projectMembers = ref<ProjectMember[]>([])
const workloadChartEl = ref<HTMLElement | null>(null)
const memberChartEl = ref<HTMLElement | null>(null)
const changeChartEl = ref<HTMLElement | null>(null)
const cumulativeChartEl = ref<HTMLElement | null>(null)
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
let membersRequestSeq = 0
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

const filteredItems = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return items.value
  return items.value.filter(item => [
    item.projectName,
    item.projectCode,
    item.internalCode,
    item.departmentName,
    displayDepartmentName(item),
    item.projectManagerName,
    displayProjectLeaderName(item),
    item.leaderUid
  ].some(value => String(value || '').toLowerCase().includes(keyword)))
})

const summaryStats = computed(() => {
  const filled = items.value.filter(item => item.reportId).length
  const currentDays = items.value.reduce((sum, item) => sum + hoursToDays(item.totalHours), 0)
  const actualDays = items.value.reduce((sum, item) => sum + hoursToDays(item.actualHours), 0)
  return { total: items.value.length, filled, currentDays: round2(currentDays), actualDays: round2(actualDays) }
})

const overviewStats = computed(() => {
  const previousDays = items.value.reduce((sum, item) => sum + hoursToDays(item.previousTotalHours), 0)
  const memberSlots = items.value.reduce((sum, item) => sum + Number(item.memberCount || 0), 0)
  const cumulativeDays = items.value.reduce((sum, item) => sum + Number(item.cumulativeLaborCost || 0), 0)
  return {
    previousDays: round2(previousDays),
    deltaDays: round2(summaryStats.value.currentDays - previousDays),
    memberSlots,
    cumulativeDays: round2(cumulativeDays)
  }
})

const workloadChartRows = computed(() => {
  return items.value
    .map(item => overviewRow(item, hoursToDays(item.totalHours)))
    .filter(row => row.value > 0)
    .sort((left, right) => right.value - left.value)
})

const memberChartRows = computed(() => {
  return items.value
    .map(item => overviewRow(item, Number(item.memberCount || 0)))
    .filter(row => row.value > 0)
    .sort((left, right) => right.value - left.value)
})

const changeChartRows = computed(() => {
  return items.value
    .map((item) => {
      const current = hoursToDays(item.totalHours)
      const previous = hoursToDays(item.previousTotalHours)
      return {
        ...overviewRow(item, round2(current - previous)),
        previousValue: round2(previous),
        delta: round2(current - previous)
      }
    })
    .filter(row => row.previousValue || row.value)
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
})

const cumulativeChartRows = computed(() => {
  return items.value
    .map(item => overviewRow(item, Number(item.cumulativeLaborCost || 0)))
    .filter(row => row.value > 0)
    .sort((left, right) => right.value - left.value)
})

const canManageWeeklyReports = computed(() => {
  return hasPermission('reports', 'edit')
    || hasPermission('reports', 'admin')
    || hasPermission('projects', 'admin')
    || hasPermission('project_templates', 'admin')
    || hasPermission('admin', 'admin')
    || hasRole('aims:admin')
    || hasRole('console:admin')
    || hasRole('console:console-dev-admin')
})

const weekLabel = computed(() => {
  const weekText = String(selectedWeek.value).padStart(2, '0')
  return `${selectedYear.value}年 第${weekText}周`
})

const exportHref = computed(() => {
  const base = String(runtimeConfig.app.baseURL || '/').replace(/\/?$/, '/')
  return `${base}api/v1/weekly-reports/export?year=${selectedYear.value}&week=${selectedWeek.value}`
})

async function loadReports() {
  loading.value = true
  try {
    const res = await $fetch<{ code: number, data: ListPayload<WeeklyReportSummaryItem> }>('/api/v1/weekly-reports', {
      query: {
        year: selectedYear.value,
        week: selectedWeek.value,
        includeWorkItems: '1'
      }
    })
    if (res.code === 0) {
      items.value = res.data.items || []
      weekStart.value = res.data.meta?.weekStart || ''
      weekEnd.value = res.data.meta?.weekEnd || ''
      if (editing.value) {
        const next = items.value.find(item => item.projectId === editing.value?.projectId)
        if (next) selectItem(next)
      }
      await nextTick()
      await renderOverviewCharts()
    }
  } catch (error) {
    console.error('[WeeklyReports] load failed:', error)
    toast.add({ title: '加载周报汇总失败', color: 'error' })
  } finally {
    loading.value = false
  }
}

function selectItem(item: WeeklyReportSummaryItem) {
  disposeOverviewCharts()
  editing.value = item
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

async function saveEditing() {
  if (!editing.value || !editForm.projectId) return
  if (!canManageWeeklyReports.value) {
    toast.add({ title: '没有周报编辑权限', color: 'warning' })
    return
  }
  saving.value = true
  try {
    const res = await $fetch<{ code: number }>(`/api/v1/projects/${editForm.projectId}/weekly-reports`, {
      method: 'POST',
      body: {
        reportYear: selectedYear.value,
        reportWeek: selectedWeek.value,
        mainWork: editForm.mainWork,
        overallProgress: editForm.overallProgress,
        progressStatus: editForm.progressStatus,
        completionPercent: editForm.completionPercent,
        paymentStatus: editForm.paymentStatus,
        cumulativeLaborCost: editForm.cumulativeLaborCost,
        majorRisks: editForm.majorRisks,
        coordinationNeeds: editForm.coordinationNeeds,
        status: editing.value.status === 'submitted' ? 'submitted' : 'draft',
        workItems: editForm.workItems
          .filter(item => item.taskSummary.trim())
          .map((item, index) => ({
            ...item,
            ownerName: item.ownerName || ownerNameForUid(item.ownerUid),
            sortOrder: index + 1
          }))
      }
    })
    if (res.code === 0) {
      toast.add({ title: '周报已保存', color: 'success' })
      await loadReports()
    }
  } catch (error) {
    console.error('[WeeklyReports] save failed:', error)
    toast.add({ title: '保存周报失败', color: 'error' })
  } finally {
    saving.value = false
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

function prevWeek() {
  const { start } = getWeekRange(selectedYear.value, selectedWeek.value)
  start.setDate(start.getDate() - 7)
  selectedYear.value = getISOWeekYear(start)
  selectedWeek.value = getISOWeekNumber(start)
  loadReports()
}

function nextWeek() {
  const { start } = getWeekRange(selectedYear.value, selectedWeek.value)
  start.setDate(start.getDate() + 7)
  selectedYear.value = getISOWeekYear(start)
  selectedWeek.value = getISOWeekNumber(start)
  loadReports()
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
  if (!canManageWeeklyReports.value) return
  editForm.workItems.push(newWorkItem())
}

function removeWorkItem(index: number) {
  if (!canManageWeeklyReports.value) return
  editForm.workItems.splice(index, 1)
  if (editForm.workItems.length === 0) editForm.workItems.push(newWorkItem())
}

function setWorkItemOwner(item: WeeklyReportWorkItem, uid: string) {
  if (!canManageWeeklyReports.value) return
  item.ownerUid = uid
  item.ownerName = ownerNameForUid(uid)
}

function hoursToDays(hours: unknown) {
  return Number(hours || 0) / 8
}

function round2(value: number) {
  return Math.round(Number(value || 0) * 100) / 100
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

function overviewRow(item: WeeklyReportSummaryItem, value: number): OverviewRankRow {
  return {
    projectId: item.projectId,
    name: item.projectName || item.internalCode || item.projectCode || `项目 ${item.projectId}`,
    code: item.internalCode || item.projectCode || String(item.projectId),
    value: round2(value)
  }
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
  return '未填报'
}

function statusColor(status: string | undefined) {
  if (status === 'submitted') return 'success'
  if (status === 'draft') return 'neutral'
  return 'warning'
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

function chartRows(rows: OverviewRankRow[], limit = 14) {
  return rows.slice(0, limit)
}

function pieRows(rows: OverviewRankRow[], limit = 10) {
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
    `<div>${param.marker || ''}数值：${round2(value)} ${unit}</div>`
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
          formatter: (params: ChartTooltipParam) => `${round2(Number(params.value || 0))}`
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
  const api = await ensureEcharts()
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
  workloadChart = await renderChart(workloadChartEl.value, workloadChart, workloadPieOption(workloadChartRows.value))
  memberChart = await renderChart(memberChartEl.value, memberChart, rankBarOption(memberChartRows.value, '人', '#0891b2'))
  changeChart = await renderChart(changeChartEl.value, changeChart, changeBarOption(changeChartRows.value))
  cumulativeChart = await renderChart(cumulativeChartEl.value, cumulativeChart, rankBarOption(cumulativeChartRows.value, '人天', '#7c3aed'))
}

function disposeOverviewCharts() {
  for (const chart of [workloadChart, memberChart, changeChart, cumulativeChart]) {
    chart?.dispose()
  }
  workloadChart = null
  memberChart = null
  changeChart = null
  cumulativeChart = null
}

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
  if (!permissionsLoaded.value) {
    await loadPermissions()
  }
  await loadReports()
})

onBeforeUnmount(() => {
  disposeOverviewCharts()
})
</script>

<template>
  <UDashboardPanel id="weekly-reports-summary" :ui="{ body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <div class="border-b border-default bg-default px-6 py-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 class="text-xl font-semibold text-highlighted">
                项目周报汇总
              </h1>
              <p class="text-sm text-muted">
                {{ weekLabel }} <span v-if="weekStart && weekEnd">({{ weekStart }} ~ {{ weekEnd }})</span>
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <UButton
                icon="i-lucide-chevron-left"
                variant="outline"
                color="neutral"
                @click="prevWeek"
              />
              <UInput v-model="selectedYear" type="number" class="w-24" />
              <UInput
                v-model="selectedWeek"
                type="number"
                min="1"
                max="53"
                class="w-20"
              />
              <UButton
                icon="i-lucide-chevron-right"
                variant="outline"
                color="neutral"
                @click="nextWeek"
              />
              <UButton
                icon="i-lucide-refresh-cw"
                variant="outline"
                color="neutral"
                :loading="loading"
                @click="loadReports"
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

        <div class="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
          <aside class="flex min-h-0 flex-col border-b border-default bg-default/80 xl:border-r xl:border-b-0">
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
                <div class="rounded-lg border border-default bg-default px-3 py-2">
                  <div class="text-muted">
                    本周人天
                  </div>
                  <div class="mt-0.5 text-base font-semibold text-highlighted">
                    {{ summaryStats.currentDays }}
                  </div>
                </div>
                <div class="rounded-lg border border-default bg-default px-3 py-2">
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
                placeholder="搜索项目、编号、部门、项目负责人"
                class="mt-3 w-full"
              />
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto p-3">
              <div v-if="loading" class="space-y-2">
                <USkeleton v-for="index in 6" :key="index" class="h-32 rounded-lg" />
              </div>

              <div v-else-if="filteredItems.length === 0" class="rounded-lg border border-dashed border-default px-4 py-10 text-center text-sm text-muted">
                <UIcon name="i-lucide-folder-open" class="mx-auto mb-2 size-8" />
                暂无周报项目
              </div>

              <div v-else class="space-y-2">
                <button
                  v-for="item in filteredItems"
                  :key="item.projectId"
                  type="button"
                  class="w-full rounded-lg border p-3 text-left transition hover:bg-elevated"
                  :class="editing?.projectId === item.projectId ? 'border-primary bg-primary/10' : 'border-default bg-default'"
                  @click="selectItem(item)"
                >
                  <div class="flex items-start justify-between gap-1">
                    <div class="min-w-0">
                      <div class="line-clamp-2 text-sm font-medium text-highlighted">
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

                  <div class="mt-1 space-y-1 text-xs text-muted flex items-center justify-between gap-2">
                    <div>
                      <span class="truncate text-right">{{ displayDepartmentName(item) }}</span>
                    </div>
                    <div>
                      <span class="shrink-0">项目经理: </span>
                      <span class="truncate text-right">{{ displayProjectLeaderName(item) }}</span>
                    </div>
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
          </aside>

          <main class="min-h-0 min-w-0 overflow-y-auto bg-elevated/20 p-4">
            <div v-if="!editing" class="mx-auto w-full max-w-[96rem] space-y-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <h2 class="text-lg font-semibold text-highlighted">
                    周报总览
                  </h2>
                  <p class="mt-1 text-xs text-muted">
                    {{ weekLabel }} <span v-if="weekStart && weekEnd">({{ weekStart }} ~ {{ weekEnd }})</span>
                  </p>
                </div>
                <UBadge color="primary" variant="subtle" size="sm">
                  已填报 {{ summaryStats.filled }} / {{ summaryStats.total }}
                </UBadge>
              </div>

              <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
                    <span>累计投入</span>
                    <UIcon name="i-lucide-database" class="size-4" />
                  </div>
                  <div class="mt-2 text-xl font-semibold text-highlighted">
                    {{ formatDays(overviewStats.cumulativeDays) }}
                  </div>
                </div>
              </div>

              <div class="grid gap-4 2xl:grid-cols-2">
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
                    class="mt-3 h-80 w-full"
                  />
                  <div v-else class="mt-3 flex h-80 items-center justify-center rounded-lg border border-dashed border-default text-sm text-muted">
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
                    class="mt-3 h-80 w-full"
                  />
                  <div v-else class="mt-3 flex h-80 items-center justify-center rounded-lg border border-dashed border-default text-sm text-muted">
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
                    class="mt-3 h-80 w-full"
                  />
                  <div v-else class="mt-3 flex h-80 items-center justify-center rounded-lg border border-dashed border-default text-sm text-muted">
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
                        按累计工作量排序
                      </p>
                    </div>
                    <UBadge color="neutral" variant="subtle" size="xs">
                      Top {{ Math.min(cumulativeChartRows.length, 14) }}
                    </UBadge>
                  </div>
                  <div
                    v-if="cumulativeChartRows.length"
                    ref="cumulativeChartEl"
                    class="mt-3 h-80 w-full"
                  />
                  <div v-else class="mt-3 flex h-80 items-center justify-center rounded-lg border border-dashed border-default text-sm text-muted">
                    暂无累计投入数据
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
                <UButton
                  v-if="canManageWeeklyReports"
                  icon="i-lucide-save"
                  label="保存"
                  color="primary"
                  :loading="saving"
                  @click="saveEditing"
                />
              </div>

              <div class="grid gap-3">
                <div class="grid gap-3 lg:grid-cols-2">
                  <UFormField label="主要工作">
                    <UTextarea
                      v-model="editForm.mainWork"
                      :rows="7"
                      :disabled="!canManageWeeklyReports"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField label="整体进展">
                    <UTextarea
                      v-model="editForm.overallProgress"
                      :rows="7"
                      :disabled="!canManageWeeklyReports"
                      class="w-full"
                    />
                  </UFormField>
                </div>
                <div class="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
                  <UFormField label="进度情况">
                    <UInput
                      v-model="editForm.progressStatus"
                      :disabled="!canManageWeeklyReports"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField label="总体完成进度">
                    <UInput
                      v-model="editForm.completionPercent"
                      type="number"
                      min="0"
                      max="100"
                      :disabled="!canManageWeeklyReports"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField label="回款情况">
                    <UInput
                      v-model="editForm.paymentStatus"
                      :disabled="!canManageWeeklyReports"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField label="累计工作量">
                    <UInput
                      v-model="editForm.cumulativeLaborCost"
                      type="number"
                      min="0"
                      :disabled="!canManageWeeklyReports"
                      class="w-full"
                    />
                  </UFormField>
                </div>
                <UFormField label="重大问题和风险">
                  <UTextarea
                    v-model="editForm.majorRisks"
                    :rows="3"
                    :disabled="!canManageWeeklyReports"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="待协调资源">
                  <UTextarea
                    v-model="editForm.coordinationNeeds"
                    :rows="3"
                    :disabled="!canManageWeeklyReports"
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
                    v-if="canManageWeeklyReports"
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
                      :disabled="!canManageWeeklyReports"
                      class="w-32"
                    />
                    <UButton
                      v-if="canManageWeeklyReports"
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
                      :disabled="!canManageWeeklyReports"
                      placeholder="选择责任人"
                      class="w-full"
                      @update:model-value="value => setWorkItemOwner(item, String(value || ''))"
                    />
                    <UInput
                      v-model="item.moduleName"
                      :disabled="!canManageWeeklyReports"
                      placeholder="模块名称"
                      class="w-full"
                    />
                  </div>
                  <UTextarea
                    v-model="item.taskSummary"
                    :rows="2"
                    :disabled="!canManageWeeklyReports"
                    placeholder="任务简述"
                    class="w-full"
                  />
                  <div class="grid gap-2 md:grid-cols-[12rem_12rem_minmax(0,1fr)]">
                    <UInput
                      v-model="item.completionPercent"
                      type="number"
                      min="0"
                      max="100"
                      :disabled="!canManageWeeklyReports"
                      placeholder="完成度%"
                      class="w-full"
                    />
                    <UInput
                      v-model="item.workloadDays"
                      type="number"
                      min="0"
                      step="0.5"
                      :disabled="!canManageWeeklyReports"
                      placeholder="工作量(人日)"
                      class="w-full"
                    />
                    <UInput
                      v-model="item.incompleteReason"
                      :disabled="!canManageWeeklyReports"
                      placeholder="未完成说明"
                      class="w-full"
                    />
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
