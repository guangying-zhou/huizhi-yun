import { createError, defineEventHandler, getHeader, getQuery, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { buildFinanceRuntimeAuthQuery, maybeCallFinanceDataRuntime } from '../../../../utils/dataRuntime'
import { mergeProjectWithFinance } from '../../../../utils/projectAccountingReadiness'

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

function runtimeErrorMetadata(error: unknown) {
  const record = error as {
    statusCode?: unknown
    statusMessage?: unknown
    data?: { code?: unknown, upstreamStatus?: unknown }
  } | null | undefined
  return {
    statusCode: Number(record?.statusCode || 0) || undefined,
    statusMessage: text(record?.statusMessage) || undefined,
    code: text(record?.data?.code) || undefined,
    upstreamStatus: Number(record?.data?.upstreamStatus || 0) || undefined,
    message: errorMessage(error)
  }
}

async function fetchAimsProjectPage(
  event: H3Event,
  path: string,
  uid: string,
  page: number,
  pageSize: number,
  keyword: string,
  projectCodes: string[],
  includeArchived: boolean
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<PageEnvelope<RuntimeRow>>>(event, path, {
    appCode: 'aims',
    scope: 'aims.read',
    method: 'GET',
    query: {
      current_user: uid,
      operator_uid: uid,
      page,
      pageSize,
      search: keyword || undefined,
      project_codes: projectCodes.length ? projectCodes.join(',') : undefined,
      include_archived: includeArchived ? '1' : undefined,
      exclude_archived: includeArchived ? undefined : '1'
    }
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Aims tenant-runtime is required for project accounting project list.' })
  }
  return unwrapRuntimeEnvelope(runtime.data)
}

async function fetchAimsProjects(
  event: H3Event,
  uid: string,
  page: number,
  pageSize: number,
  keyword: string,
  projectCodes: string[],
  includeArchived: boolean
) {
  try {
    return await fetchAimsProjectPage(event, '/v1/aims/admin/projects', uid, page, pageSize, keyword, projectCodes, includeArchived)
  } catch (adminError) {
    if (text((adminError as { statusCode?: unknown })?.statusCode) === '503') throw adminError
    try {
      return await fetchAimsProjectPage(event, '/v1/aims/projects', uid, page, pageSize, keyword, projectCodes, includeArchived)
    } catch (projectError) {
      console.warn('[finance-project-accounting] Aims project list rejected', {
        admin: runtimeErrorMetadata(adminError),
        projects: runtimeErrorMetadata(projectError)
      })
      throw projectError
    }
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
  const projectFinanceAuthQuery = await buildFinanceRuntimeAuthQuery(event, '/v1/finance/project-accounting', 'GET', {})
  const financeAccess = projectFinanceAccess(projectFinanceAuthQuery)
  const scopedProjectCodes = projectFinanceAllowedCodes(projectFinanceAuthQuery)
  const aimsProjects = financeAccess === 'projects' && scopedProjectCodes.length === 0
    ? { items: [], total: 0, page, pageSize }
    : await fetchAimsProjects(
        event,
        uid,
        page,
        pageSize,
        keyword,
        financeAccess === 'projects' ? scopedProjectCodes : [],
        showArchivedProjects
      )
  const projects = filterProjectsByFinanceAccess(
    runtimePageItems(aimsProjects).filter(project => showArchivedProjects || !isArchivedProject(project)),
    projectFinanceAuthQuery
  )
  const visibleProjectCodes = projectCodesFromProjects(projects)
  const resolvedFinance = visibleProjectCodes.length
    ? await fetchProjectFinanceResolve(event, periodMonth, visibleProjectCodes).catch(error => ({
        rows: [] as RuntimeRow[],
        laborRows: [] as RuntimeRow[],
        warning: errorMessage(error)
      }))
    : { rows: [] as RuntimeRow[], laborRows: [] as RuntimeRow[], warning: '' }
  const summaryRows = resolvedFinance.rows
  const laborRows = resolvedFinance.laborRows
  const financeWarning = resolvedFinance.warning
  const summaryByProject = latestFinanceSummaryByProject(summaryRows)
  const laborAmountByProject = laborAllocationAmountByProject(laborRows)
  const data = projects.map((project) => {
    const projectCode = text(project.project_code || project.projectCode)
    return mergeProjectWithFinance(project, summaryByProject.get(projectCode), periodMonth, laborAmountByProject.get(projectCode) || 0)
  })

  return {
    code: 0,
    data: {
      data,
      total: Number(aimsProjects?.total || 0),
      page: Number(aimsProjects?.page || page),
      pageSize: Number(aimsProjects?.pageSize || pageSize),
      warning: financeWarning || aimsProjects?.warning
    }
  }
})
