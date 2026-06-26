import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { checkPermission } from '~~/server/utils/checkPermission'
import { createXlsxWorkbook } from '~~/server/utils/simpleXlsx'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface WeeklyReportWorkItem {
  planType?: string
  moduleName?: string
  sortOrder?: number
  taskSummary?: string
  ownerUid?: string
  ownerName?: string
  completionPercent?: number | null
  incompleteReason?: string
  workloadDays?: number | null
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
  status?: string
  totalHours?: number
  previousTotalHours?: number
  actualHours?: number
  memberCount?: number
  workItems?: WeeklyReportWorkItem[]
}

interface WeeklyReportSummaryPayload {
  items?: WeeklyReportSummaryItem[]
  meta?: {
    reportYear?: number
    reportWeek?: number
    weekStart?: string
    weekEnd?: string
  }
}

const summaryHeaders = [
  '序号',
  '隶属部门',
  '项目类型',
  '项目编号',
  '项目名称',
  '项目经理',
  '立项情况',
  '当前阶段',
  '进度情况',
  '总体完成进度',
  '合同状态（合同额）',
  '回款情况',
  '累计人力成本',
  '上周人力投入(人天)',
  '本周人力投入(人天)',
  '人力较上周',
  '重大问题和风险',
  '待协调资源',
  '备注'
]

const detailHeaders = [
  '项目信息',
  '项目经理',
  '当前进度',
  '合同回款情况',
  '工作/计划',
  '模块名称',
  '序号',
  '任务简述（多人完成可以合并单元格）',
  '责任人（只能填一个人）',
  '完成度',
  '未完成情况说明',
  '工作量（人日）'
]

function unwrapRuntimeData<T>(value: RuntimeEnvelope<T>): T {
  if (value.code !== undefined && value.code !== 0) {
    throw createError({ statusCode: 502, message: value.message || 'Aims tenant-runtime returned an error.' })
  }
  return value.data as T
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const allowed = await checkPermission(event, 'reports', 'export')
  if (!allowed) {
    throw createError({ statusCode: 403, message: '权限不足' })
  }

  const query = getQuery(event)
  const year = Number(query.year || query.reportYear || new Date().getFullYear())
  const week = Number(query.week || query.reportWeek || getISOWeekNumber(new Date()))
  if (!year || Number.isNaN(year) || !week || Number.isNaN(week)) {
    throw createError({ statusCode: 400, message: '无效的周报年份或周序号' })
  }

  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<WeeklyReportSummaryPayload>>(
    event,
    '/v1/aims/weekly-reports/export-data',
    {
      appCode: 'aims',
      scope: 'aims.read',
      method: 'GET',
      query: {
        current_user: uid,
        current_user_can_view_weekly_report_summary: '1',
        year,
        week,
        includeWorkItems: '1'
      }
    }
  )
  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Aims tenant-runtime is required for weekly report export.'
    })
  }

  const payload = unwrapRuntimeData(runtime.data)
  const items = payload.items || []
  const meta = payload.meta || {}
  const workbook = createXlsxWorkbook([
    {
      name: '项目汇总',
      rows: buildSummaryRows(items)
    },
    ...buildDetailSheets(items)
  ])

  const filename = `项目周报汇总-${meta.reportYear || year}-W${String(meta.reportWeek || week).padStart(2, '0')}.xlsx`
  setResponseHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
  return workbook
})

function buildSummaryRows(items: WeeklyReportSummaryItem[]) {
  const rows: Array<Array<string | number | null>> = [
    ['项目周报汇总', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    summaryHeaders
  ]
  const groups = groupByDepartment(items)
  let sequence = 1
  for (const [department, groupItems] of groups) {
    let previousDaysTotal = 0
    let currentDaysTotal = 0
    for (const item of groupItems) {
      const previousDays = hoursToDays(item.previousTotalHours)
      const currentDays = hoursToDays(item.totalHours)
      previousDaysTotal += previousDays
      currentDaysTotal += currentDays
      rows.push([
        sequence++,
        department,
        text(item.projectTypeName || item.projectCategory),
        text(item.internalCode || item.projectCode),
        text(item.projectName),
        text(item.projectManagerName || item.leaderUid),
        text(item.initiationStatus),
        text(item.currentStage || item.lifecycleStatus),
        text(item.progressStatus),
        percentText(item.completionPercent),
        contractText(item),
        text(item.paymentStatus),
        nullableNumber(item.cumulativeLaborCost),
        round2(previousDays),
        round2(currentDays),
        laborDeltaText(previousDays, currentDays),
        text(item.majorRisks),
        text(item.coordinationNeeds),
        text(item.remarks)
      ])
    }
    rows.push([
      '',
      `${department} 人力小计：`,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      round2(previousDaysTotal),
      round2(currentDaysTotal),
      laborDeltaText(previousDaysTotal, currentDaysTotal),
      '',
      '',
      ''
    ])
  }
  return rows
}

function buildDetailSheets(items: WeeklyReportSummaryItem[]) {
  return [...groupByDepartment(items)].map(([department, groupItems]) => {
    const rows: Array<Array<string | number | null>> = [detailHeaders]
    for (const item of groupItems) {
      const workItems = normalizedWorkItems(item)
      for (let index = 0; index < workItems.length; index++) {
        const workItem = workItems[index]!
        rows.push([
          text(item.projectName),
          text(item.projectManagerName || item.leaderUid),
          text(item.progressStatus || item.overallProgress || item.currentStage),
          compactText([contractText(item), item.paymentStatus]),
          planTypeLabel(workItem.planType),
          text(workItem.moduleName),
          workItem.sortOrder || index + 1,
          text(workItem.taskSummary),
          text(workItem.ownerName || workItem.ownerUid),
          percentText(workItem.completionPercent),
          text(workItem.incompleteReason),
          nullableNumber(workItem.workloadDays)
        ])
      }
    }
    return { name: department, rows }
  })
}

function normalizedWorkItems(item: WeeklyReportSummaryItem): WeeklyReportWorkItem[] {
  if (item.workItems?.length) return item.workItems
  const summary = compactText([item.mainWork, item.overallProgress])
  if (!summary) return []
  return [{
    planType: 'this_week',
    taskSummary: summary,
    ownerName: item.projectManagerName || item.leaderUid,
    workloadDays: hoursToDays(item.totalHours)
  }]
}

function groupByDepartment(items: WeeklyReportSummaryItem[]) {
  const groups = new Map<string, WeeklyReportSummaryItem[]>()
  for (const item of items) {
    const department = text(item.departmentName || item.deptCode || '未分组')
    if (!groups.has(department)) groups.set(department, [])
    groups.get(department)!.push(item)
  }
  return groups
}

function hoursToDays(hours: unknown) {
  return Number(hours || 0) / 8
}

function laborDeltaText(previousDays: number, currentDays: number) {
  if (!previousDays && !currentDays) return '0%'
  if (!previousDays) return '新增'
  const percent = ((currentDays - previousDays) / previousDays) * 100
  return `${percent >= 0 ? '+' : ''}${round2(percent)}%`
}

function contractText(item: WeeklyReportSummaryItem) {
  const parts = [item.contractStatus]
  if (item.contractAmount !== null && item.contractAmount !== undefined) {
    parts.push(`${item.contractAmount}`)
  }
  return compactText(parts)
}

function compactText(values: Array<unknown>) {
  return values.map(value => text(value)).filter(Boolean).join(' / ')
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function percentText(value: unknown) {
  const numeric = nullableNumber(value)
  if (numeric === null) return ''
  return `${round2(numeric)}%`
}

function planTypeLabel(value: unknown) {
  return String(value || '') === 'next_week' ? '下周计划' : '本周工作'
}

function round2(value: number) {
  return Math.round(Number(value || 0) * 100) / 100
}

function getISOWeekNumber(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}
