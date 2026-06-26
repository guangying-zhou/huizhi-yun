import { createError, defineEventHandler, getHeader, getQuery, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { buildFinanceRuntimeAuthQuery, maybeCallFinanceDataRuntime } from '../../../../utils/dataRuntime'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface PageEnvelope<T> {
  items?: T[]
  data?: T[]
  total?: number
  page?: number
  pageSize?: number
  warning?: string
}

type RuntimeRow = Record<string, unknown>

interface ProjectFinanceResolveResult {
  summaries?: RuntimeRow[]
  laborAllocations?: RuntimeRow[]
  labor_allocations?: RuntimeRow[]
}

function text(value: unknown) {
  return String(value || '').trim()
}

function numberQuery(value: unknown, fallback: number, max: number) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.min(Math.floor(numeric), max)
}

function currentUser(event: H3Event) {
  const auth = event.context.consoleAuth as { authenticated?: boolean, uid?: string | null } | undefined
  return text(auth?.uid) || text(getHeader(event, 'x-hzy-actor-uid'))
}

function unwrapRuntimeEnvelope<T>(value: RuntimeEnvelope<T>) {
  if (value.code !== undefined && value.code !== 0) {
    throw createError({ statusCode: 502, message: value.message || 'Tenant runtime returned an error.' })
  }
  return value.data as T
}

function runtimePageItems<T extends RuntimeRow>(page: PageEnvelope<T> | null | undefined) {
  if (!page) return []
  if (Array.isArray(page.items)) return page.items
  if (Array.isArray(page.data)) return page.data
  return []
}

function moneyValue(value: unknown) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function normalizePeriodMonth(value: unknown) {
  const month = text(value)
  if (!month) return ''
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw createError({ statusCode: 400, message: 'periodMonth must be YYYY-MM.' })
  }
  return month
}

function isTruthy(value: unknown) {
  return ['1', 'true', 'yes', 'on'].includes(text(value).toLowerCase())
}

function matchesPeriodMonth(row: RuntimeRow, periodMonth: string) {
  return !periodMonth || text(row.period_month || row.periodMonth) === periodMonth
}

function isLaborAllocation(row: RuntimeRow) {
  return text(row.allocation_type || row.allocationType) === 'labor'
}

function isArchivedProject(row: RuntimeRow) {
  return text(row.lifecycle_status || row.lifecycleStatus) === 'archived'
}

function latestFinanceSummaryByProject(rows: RuntimeRow[]) {
  const map = new Map<string, RuntimeRow>()
  for (const row of rows) {
    const projectCode = text(row.project_code || row.projectCode)
    if (!projectCode || map.has(projectCode)) continue
    map.set(projectCode, row)
  }
  return map
}

function laborAllocationAmountByProject(rows: RuntimeRow[]) {
  const map = new Map<string, number>()
  for (const row of rows) {
    const projectCode = text(row.project_code || row.projectCode)
    if (!projectCode) continue
    map.set(projectCode, (map.get(projectCode) || 0) + moneyValue(row.amount))
  }
  return map
}

function projectCodesFromProjects(projects: RuntimeRow[]) {
  const codes: string[] = []
  const seen = new Set<string>()
  for (const project of projects) {
    const projectCode = text(project.project_code || project.projectCode)
    if (!projectCode || seen.has(projectCode)) continue
    seen.add(projectCode)
    codes.push(projectCode)
  }
  return codes
}

function splitCodes(value: unknown) {
  return text(value)
    .split(/[,\s;]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function projectFinanceAccess(query: RuntimeRow) {
  return text(query.current_user_project_finance_access || query.currentUserProjectFinanceAccess)
}

function projectFinanceAllowedCodes(query: RuntimeRow) {
  return splitCodes(query.current_user_project_finance_project_codes || query.currentUserProjectFinanceProjectCodes)
}

function filterProjectsByFinanceAccess(projects: RuntimeRow[], authQuery: RuntimeRow) {
  const access = projectFinanceAccess(authQuery)
  if (!access || access === 'all') return projects
  if (access !== 'projects') return []

  const allowedCodes = new Set(projectFinanceAllowedCodes(authQuery))
  if (allowedCodes.size === 0) return []
  return projects.filter((project) => {
    const projectCode = text(project.project_code || project.projectCode)
    return projectCode && allowedCodes.has(projectCode)
  })
}

function runtimeRows(value: unknown) {
  return Array.isArray(value) ? value as RuntimeRow[] : []
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  const record = error as { message?: unknown, statusMessage?: unknown } | null | undefined
  return text(record?.message || record?.statusMessage) || 'Finance project summary is unavailable.'
}

function mergeProjectWithFinance(project: RuntimeRow, summary: RuntimeRow | undefined, periodMonth: string, laborAllocationAmount: number) {
  const projectCode = text(project.project_code || project.projectCode)
  const projectName = text(project.name || project.project_name || project.projectName || project.short_name || project.shortName)
  const hasSummary = Boolean(summary)
  const summaryLaborCostAmount = moneyValue(summary?.labor_cost_amount || summary?.laborCostAmount)
  const laborCostAmount = summaryLaborCostAmount > 0 ? summaryLaborCostAmount : laborAllocationAmount
  const allocatedCostAmount = moneyValue(summary?.allocated_cost_amount || summary?.allocatedCostAmount)
  const hasLaborCost = laborCostAmount > 0 || allocatedCostAmount > 0
  const financeStatus = hasSummary ? 'summary_ready' : 'summary_pending'
  const costStatus = hasLaborCost ? 'cost_ready' : 'cost_pending'
  const receivedAmount = summary?.received_amount ?? summary?.receivedAmount ?? null
  const directExpenseAmount = summary?.direct_expense_amount ?? summary?.directExpenseAmount ?? null
  const grossProfitAmount = hasSummary && summaryLaborCostAmount <= 0 && laborAllocationAmount > 0
    ? (moneyValue(receivedAmount) - moneyValue(directExpenseAmount) - laborCostAmount - allocatedCostAmount).toFixed(2)
    : (summary?.gross_profit_amount ?? summary?.grossProfitAmount ?? null)

  return {
    ...(summary || {}),
    aims_project_id: project.id,
    project_code: projectCode,
    project_name: text(summary?.project_name || summary?.projectName) || projectName || projectCode,
    customer_code: text(summary?.customer_code || summary?.customerCode) || text(project.customer_code || project.customerCode),
    customer_name: text(project.customer_name || project.customerName),
    contract_code: text(summary?.contract_code || summary?.contractCode) || text(project.contract_code || project.contractCode),
    lifecycle_status: text(project.lifecycle_status || project.lifecycleStatus),
    period_month: text(summary?.period_month || summary?.periodMonth) || periodMonth || null,
    contract_amount: summary?.contract_amount ?? summary?.contractAmount ?? null,
    invoice_amount: summary?.invoice_amount ?? summary?.invoiceAmount ?? null,
    received_amount: receivedAmount,
    direct_expense_amount: directExpenseAmount,
    labor_cost_amount: laborCostAmount > 0 ? laborCostAmount.toFixed(2) : null,
    allocated_cost_amount: summary?.allocated_cost_amount ?? summary?.allocatedCostAmount ?? null,
    gross_profit_amount: grossProfitAmount,
    gross_margin_rate: summary?.gross_margin_rate ?? summary?.grossMarginRate ?? null,
    calculated_at: summary?.calculated_at ?? summary?.calculatedAt ?? null,
    finance_status: financeStatus,
    finance_status_label: hasSummary ? '已有财务摘要' : (hasLaborCost ? '已有成本分摊' : '待财务归集'),
    cost_status: costStatus,
    cost_status_label: hasLaborCost ? '人力成本已同步' : '人力成本未就绪'
  }
}

async function fetchAimsProjectPage(event: H3Event, path: string, uid: string, page: number, pageSize: number, keyword: string) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<PageEnvelope<RuntimeRow>>>(event, path, {
    appCode: 'aims',
    scope: 'aims.read',
    method: 'GET',
    query: {
      current_user: uid,
      operator_uid: uid,
      page,
      pageSize,
      search: keyword || undefined
    }
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Aims tenant-runtime is required for project accounting project list.' })
  }
  return unwrapRuntimeEnvelope(runtime.data)
}

async function fetchAimsProjects(event: H3Event, uid: string, page: number, pageSize: number, keyword: string) {
  try {
    return await fetchAimsProjectPage(event, '/v1/aims/admin/projects', uid, page, pageSize, keyword)
  } catch (error) {
    if (text((error as { statusCode?: unknown })?.statusCode) === '503') throw error
    return await fetchAimsProjectPage(event, '/v1/aims/projects', uid, page, pageSize, keyword)
  }
}

async function fetchAllFinanceRows(event: H3Event, path: string, scope: string, query: RuntimeRow) {
  const rows: RuntimeRow[] = []
  let warning = ''
  for (let page = 1; page <= 100; page++) {
    const authQuery = await buildFinanceRuntimeAuthQuery(event, path, 'GET', query)
    const runtime = await maybeCallFinanceDataRuntime<RuntimeEnvelope<PageEnvelope<RuntimeRow>>>(event, path, {
      scope,
      method: 'GET',
      query: {
        ...authQuery,
        page,
        pageSize: 100
      }
    })
    if (!runtime.handled) return { rows, warning: 'Finance tenant-runtime summary is unavailable.' }
    const data = unwrapRuntimeEnvelope(runtime.data)
    const items = runtimePageItems(data)
    rows.push(...items)
    warning = text(data?.warning) || warning
    const total = Number(data?.total || rows.length)
    if (items.length === 0 || rows.length >= total) break
  }
  return { rows, warning }
}

async function fetchFinanceSummaries(event: H3Event, periodMonth: string) {
  const filtered = await fetchAllFinanceRows(event, '/v1/finance/project-accounting', 'finance.project_accounting.read', {
    period_month: periodMonth || undefined,
    periodMonth: periodMonth || undefined
  })
  const periodRows = filtered.rows.filter(row => matchesPeriodMonth(row, periodMonth))
  if (!periodMonth || periodRows.length > 0) {
    return { rows: periodRows, warning: filtered.warning }
  }

  const allRows = await fetchAllFinanceRows(event, '/v1/finance/project-accounting', 'finance.project_accounting.read', {})
  return {
    rows: allRows.rows.filter(row => matchesPeriodMonth(row, periodMonth)),
    warning: filtered.warning || allRows.warning
  }
}

async function fetchLaborCostAllocations(event: H3Event, periodMonth: string) {
  const filtered = await fetchAllFinanceRows(event, '/v1/finance/project-cost-allocations', 'finance.project_cost_allocations.read', {
    period_month: periodMonth || undefined,
    periodMonth: periodMonth || undefined,
    allocation_type: 'labor'
  })
  const laborRows = filtered.rows.filter(row => matchesPeriodMonth(row, periodMonth) && isLaborAllocation(row))
  if (!periodMonth || laborRows.length > 0) {
    return { rows: laborRows, warning: filtered.warning }
  }

  const allRows = await fetchAllFinanceRows(event, '/v1/finance/project-cost-allocations', 'finance.project_cost_allocations.read', {})
  return {
    rows: allRows.rows.filter(row => matchesPeriodMonth(row, periodMonth) && isLaborAllocation(row)),
    warning: filtered.warning || allRows.warning
  }
}

async function fetchProjectFinanceResolve(event: H3Event, periodMonth: string, projectCodes: string[]) {
  const query = await buildFinanceRuntimeAuthQuery(event, '/v1/finance/project-accounting/resolve', 'GET', {
    period_month: periodMonth || undefined,
    periodMonth: periodMonth || undefined,
    project_codes: projectCodes.length ? projectCodes.join(',') : undefined,
    projectCodes: projectCodes.length ? projectCodes.join(',') : undefined
  })
  const runtime = await maybeCallFinanceDataRuntime<RuntimeEnvelope<ProjectFinanceResolveResult>>(
    event,
    '/v1/finance/project-accounting/resolve',
    {
      scope: 'finance.project_accounting.read',
      method: 'GET',
      query
    }
  )
  if (!runtime.handled) {
    return { rows: [] as RuntimeRow[], laborRows: [] as RuntimeRow[], warning: 'Finance tenant-runtime resolve is unavailable.' }
  }
  const data = unwrapRuntimeEnvelope(runtime.data)
  return {
    rows: runtimeRows(data?.summaries).filter(row => matchesPeriodMonth(row, periodMonth)),
    laborRows: runtimeRows(data?.laborAllocations || data?.labor_allocations)
      .filter(row => matchesPeriodMonth(row, periodMonth) && isLaborAllocation(row)),
    warning: ''
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const uid = currentUser(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: 'Current user is required to read Aims projects.' })
  }

  const page = numberQuery(query.page, 1, 100000)
  const pageSize = numberQuery(query.pageSize, 20, 500)
  const keyword = text(query.keyword || query.search)
  const periodMonth = normalizePeriodMonth(query.periodMonth || query.period_month)
  const showArchivedProjects = isTruthy(query.showArchivedProjects || query.show_archived_projects)
  const aimsProjects = await fetchAimsProjects(event, uid, page, pageSize, keyword)
  const projectFinanceAuthQuery = await buildFinanceRuntimeAuthQuery(event, '/v1/finance/project-accounting', 'GET', {})
  const projects = filterProjectsByFinanceAccess(
    runtimePageItems(aimsProjects).filter(project => showArchivedProjects || !isArchivedProject(project)),
    projectFinanceAuthQuery
  )
  const visibleProjectCodes = projectCodesFromProjects(projects)
  const scopedProjectCodes = projectFinanceAllowedCodes(projectFinanceAuthQuery)
  const resolvedFinance = await fetchProjectFinanceResolve(event, periodMonth, scopedProjectCodes.length ? scopedProjectCodes : visibleProjectCodes).catch(error => ({
    rows: [] as RuntimeRow[],
    laborRows: [] as RuntimeRow[],
    warning: errorMessage(error)
  }))
  let summaryRows = resolvedFinance.rows
  let laborRows = resolvedFinance.laborRows
  let financeWarning = resolvedFinance.warning
  if (summaryRows.length === 0 && laborRows.length === 0) {
    const [financeSummaries, laborCostAllocations] = await Promise.all([
      fetchFinanceSummaries(event, periodMonth).catch(error => ({
        rows: [] as RuntimeRow[],
        warning: errorMessage(error)
      })),
      fetchLaborCostAllocations(event, periodMonth).catch(error => ({
        rows: [] as RuntimeRow[],
        warning: errorMessage(error)
      }))
    ])
    summaryRows = financeSummaries.rows
    laborRows = laborCostAllocations.rows
    financeWarning = financeSummaries.warning || laborCostAllocations.warning || financeWarning
  }
  const summaryByProject = latestFinanceSummaryByProject(summaryRows)
  const laborAmountByProject = laborAllocationAmountByProject(laborRows)
  const projectCodes = new Set<string>()
  const data = projects.map((project) => {
    const projectCode = text(project.project_code || project.projectCode)
    if (projectCode) projectCodes.add(projectCode)
    return mergeProjectWithFinance(project, summaryByProject.get(projectCode), periodMonth, laborAmountByProject.get(projectCode) || 0)
  })
  const financeProjectCodes = new Set<string>([
    ...summaryByProject.keys(),
    ...laborAmountByProject.keys()
  ])
  for (const projectCode of financeProjectCodes) {
    if (!projectCode || projectCodes.has(projectCode)) continue
    const summary = summaryByProject.get(projectCode)
    if (!showArchivedProjects && isArchivedProject(summary || {})) continue
    data.push(mergeProjectWithFinance(
      { id: null, project_code: projectCode, name: text(summary?.project_name || summary?.projectName) || projectCode },
      summary,
      periodMonth,
      laborAmountByProject.get(projectCode) || 0
    ))
  }

  return {
    code: 0,
    data: {
      data,
      total: projectFinanceAccess(projectFinanceAuthQuery) === 'projects'
        ? data.length
        : Math.max(Number(aimsProjects?.total || 0), data.length),
      page: Number(aimsProjects?.page || page),
      pageSize: Number(aimsProjects?.pageSize || pageSize),
      warning: financeWarning || aimsProjects?.warning
    }
  }
})
