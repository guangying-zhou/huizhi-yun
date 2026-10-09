import { createError, defineEventHandler, readBody, type H3Event } from 'h3'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { crossAppForwardedHeaders } from '@hzy/foundation/server/utils/crossAppForwardedHeaders'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import {
  buildFinanceRuntimeAuthBody,
  buildFinanceRuntimeAuthQuery,
  maybeCallFinanceDataRuntime
} from '../../../../utils/dataRuntime'
import {
  aggregateHours,
  buildProjectLaborCostPlan,
  buildProjectLaborCostSyncCommand
} from '../../../../utils/projectPeopleCostSync'

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

interface PeopleStandardCostResolution {
  effective_date?: string
  effectiveDate?: string
  employee_count?: number
  employeeCount?: number
  resolved?: number
  items?: RuntimeRow[]
  skipped?: Array<{ employee_uid?: string, employeeUid?: string, reason?: string, rank_code?: string, rankCode?: string }>
}

interface WorkCalendarMonth {
  calendarCode?: string
  yearMonth?: string
  workdayCount?: number
  standardHoursPerDay?: number
  standardWorkHours?: number
  source?: string
  calculatedAt?: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function splitCodes(value: unknown) {
  return text(value)
    .split(/[,\s;]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

async function assertProjectFinanceWriteAccess(event: H3Event, projectCode: string) {
  const authQuery = await buildFinanceRuntimeAuthQuery(event, '/v1/finance/project-accounting/recalculate', 'POST', {})
  const access = text(authQuery.current_user_project_finance_access || authQuery.currentUserProjectFinanceAccess)
  if (access === 'all') return
  if (access === 'projects') {
    const allowedCodes = new Set(splitCodes(authQuery.current_user_project_finance_project_codes || authQuery.currentUserProjectFinanceProjectCodes))
    if (allowedCodes.has(projectCode)) return
  }
  throw createError({ statusCode: 403, message: 'Project accounting scope does not allow this project.' })
}

function normalizePeriodMonth(value: unknown) {
  const month = text(value) || new Date().toISOString().slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw createError({ statusCode: 400, message: 'periodMonth must be YYYY-MM.' })
  }
  return month
}

function requireProjectCode(body: RuntimeRow) {
  const projectCode = text(body.projectCode || body.project_code)
  if (!projectCode) {
    throw createError({ statusCode: 400, message: 'projectCode is required.' })
  }
  return projectCode
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function appendPath(baseUrl: string, path: string) {
  return `${trimTrailingSlash(baseUrl)}/${path.replace(/^\/+/, '')}`
}

function monthRange(periodMonth: string) {
  const [yearText, monthText] = periodMonth.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    startDate: `${periodMonth}-01`,
    endDate: `${periodMonth}-${String(lastDay).padStart(2, '0')}`
  }
}

function unwrapRuntimeEnvelope<T>(value: RuntimeEnvelope<T>, fallbackMessage: string) {
  if (value.code !== undefined && value.code !== 0) {
    throw createError({ statusCode: 502, message: value.message || fallbackMessage })
  }
  return value.data as T
}

function runtimePageItems<T extends RuntimeRow>(page: PageEnvelope<T> | null | undefined) {
  if (!page) return []
  if (Array.isArray(page.items)) return page.items
  if (Array.isArray(page.data)) return page.data
  return []
}

async function callAimsRuntime<T>(event: H3Event, path: string, query: RuntimeRow) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'aims',
    scope: 'aims.read',
    method: 'GET',
    query
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Aims tenant-runtime is required for project labor cost sync.' })
  }
  return unwrapRuntimeEnvelope(runtime.data, 'Aims tenant-runtime returned an error.')
}

async function callPeopleRuntime<T>(event: H3Event, path: string, query: RuntimeRow) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'people',
    scope: 'people.read',
    method: 'GET',
    query
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'People tenant-runtime is required for project labor cost sync.' })
  }
  return unwrapRuntimeEnvelope(runtime.data, 'People tenant-runtime returned an error.')
}

async function callFinanceRuntime<T>(event: H3Event, path: string, query: RuntimeRow = {}) {
  const runtime = await maybeCallFinanceDataRuntime<RuntimeEnvelope<T>>(event, path, {
    scope: 'finance.settings.read',
    method: 'GET',
    query
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Finance tenant-runtime is required for project labor cost sync.' })
  }
  return unwrapRuntimeEnvelope(runtime.data, 'Finance tenant-runtime returned an error.')
}

async function postFinanceRuntime<T>(
  event: H3Event,
  path: string,
  body: RuntimeRow,
  options: { trustProjectScopedEmployeeCostWrite?: boolean } = {}
) {
  const authQuery = await buildFinanceRuntimeAuthQuery(event, path, 'POST', {})
  if (options.trustProjectScopedEmployeeCostWrite && path === '/v1/finance/employee-costs') {
    authQuery.current_user_project_finance_access = 'all'
    delete authQuery.current_user_project_finance_project_codes
    delete authQuery.currentUserProjectFinanceProjectCodes
  }
  const runtime = await maybeCallFinanceDataRuntime<RuntimeEnvelope<T>>(event, path, {
    scope: 'finance.write',
    method: 'POST',
    query: authQuery,
    body: buildFinanceRuntimeAuthBody(path, 'POST', body, authQuery)
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Finance tenant-runtime is required for project labor cost sync.' })
  }
  return runtime.data.data ?? null
}

async function fetchAimsProject(event: H3Event, projectCode: string) {
  const page = await callAimsRuntime<PageEnvelope<RuntimeRow>>(event, '/v1/aims/admin/projects', {
    search: projectCode,
    page: 1,
    pageSize: 100
  })
  const project = runtimePageItems(page).find(item => text(item.project_code || item.projectCode) === projectCode)
  if (!project) {
    throw createError({ statusCode: 404, message: `Aims project not found: ${projectCode}` })
  }
  return project
}

async function fetchAimsProjectTimeEntries(event: H3Event, projectId: string, startDate: string, endDate: string) {
  const page = await callAimsRuntime<PageEnvelope<RuntimeRow>>(event, `/v1/aims/projects/${encodeURIComponent(projectId)}/time-entries`, {
    start_date: startDate,
    end_date: endDate
  })
  return runtimePageItems(page)
}

async function fetchPeopleStandardCosts(event: H3Event, employeeUids: string[], effectiveDate: string) {
  if (employeeUids.length === 0) {
    return { items: [], skipped: [] } as PeopleStandardCostResolution
  }
  return await callPeopleRuntime<PeopleStandardCostResolution>(event, '/v1/people/service/standard-costs:resolve', {
    employee_uids: employeeUids.join(','),
    effective_date: effectiveDate
  })
}

async function fetchConsoleWorkCalendarMonth(event: H3Event, periodMonth: string) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'console', { basePath: '/' })
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Console service API base URL is not configured.' })
  }

  const token = await requestServiceAccessToken({
    audience: 'system_settings',
    scope: 'system_settings:view',
    event
  })
  const response = await $fetch<RuntimeEnvelope<WorkCalendarMonth>>(
    appendPath(baseUrl, '/api/v1/console/service/work-calendar/month'),
    {
      method: 'GET',
      query: {
        calendarCode: 'CN',
        yearMonth: periodMonth
      },
      headers: {
        ...crossAppForwardedHeaders(event),
        authorization: `Bearer ${token}`
      },
      timeout: 10000
    }
  )
  return unwrapRuntimeEnvelope(response, 'Console work calendar returned an error.')
}

function uniqueEmployeeUids(hoursByEmployee: Map<string, number>) {
  return [...hoursByEmployee.entries()]
    .filter(([, hours]) => hours > 0)
    .map(([employeeUid]) => employeeUid)
    .sort()
}

async function fetchCurrentLaborInputHash(event: H3Event, projectCode: string, periodMonth: string) {
  const path = '/v1/finance/project-accounting/resolve'
  const authQuery = await buildFinanceRuntimeAuthQuery(event, path, 'GET', {
    project_codes: projectCode,
    period_month: periodMonth
  })
  const runtime = await maybeCallFinanceDataRuntime<RuntimeEnvelope<{ summaries?: RuntimeRow[] }>>(event, path, {
    scope: 'finance.project_accounting.read',
    method: 'GET',
    query: authQuery
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Finance tenant-runtime is required for project labor preflight.' })
  }
  const data = unwrapRuntimeEnvelope(runtime.data, 'Finance project labor preflight returned an error.')
  const summary = (data.summaries || []).find(item => text(item.project_code || item.projectCode) === projectCode)
  return text(summary?.cost_input_hash || summary?.costInputHash) || null
}

export default defineEventHandler(async (event) => {
  const body = ((await readBody<RuntimeRow>(event).catch(() => ({} as RuntimeRow))) || {}) as RuntimeRow
  const projectCode = requireProjectCode(body)
  const periodMonth = normalizePeriodMonth(body.periodMonth || body.period_month)
  const calculatedBy = text(body.calculatedBy || body.calculated_by) || 'finance.standard-labor-cost-sync'
  const { startDate, endDate } = monthRange(periodMonth)
  await assertProjectFinanceWriteAccess(event, projectCode)

  const expectedInputHash = await fetchCurrentLaborInputHash(event, projectCode, periodMonth)
  const additionalReasons: Array<{ code: string, employeeUid?: string }> = []
  let projectId = ''
  let projectTimeEntries: RuntimeRow[] = []
  try {
    const project = await fetchAimsProject(event, projectCode)
    projectId = text(project.id)
    if (!projectId) additionalReasons.push({ code: 'aims_project_id_missing' })
  } catch {
    additionalReasons.push({ code: 'aims_project_unavailable' })
  }
  if (projectId) {
    try {
      projectTimeEntries = await fetchAimsProjectTimeEntries(event, projectId, startDate, endDate)
    } catch {
      additionalReasons.push({ code: 'aims_time_entries_unavailable' })
    }
  }
  const projectHoursByEmployee = aggregateHours(projectTimeEntries)
  const employeeUids = uniqueEmployeeUids(projectHoursByEmployee)
  const [costParametersResult, peopleStandardCostsResult, workCalendarResult] = await Promise.allSettled([
    callFinanceRuntime<RuntimeRow>(event, '/v1/finance/service/people-cost-parameters', { effective_date: endDate }),
    fetchPeopleStandardCosts(event, employeeUids, endDate),
    fetchConsoleWorkCalendarMonth(event, periodMonth)
  ])
  const costParameters = costParametersResult.status === 'fulfilled' && costParametersResult.value
    ? costParametersResult.value
    : {}
  if (costParametersResult.status === 'rejected') {
    additionalReasons.push({ code: 'finance_cost_parameters_unavailable' })
  }
  const peopleStandardCosts: PeopleStandardCostResolution = peopleStandardCostsResult.status === 'fulfilled' && peopleStandardCostsResult.value
    ? peopleStandardCostsResult.value
    : {
        items: [],
        skipped: employeeUids.map(employeeUid => ({
          employee_uid: employeeUid,
          reason: 'people_standard_cost_unavailable'
        }))
      }
  if (peopleStandardCostsResult.status === 'rejected' && employeeUids.length === 0) {
    additionalReasons.push({ code: 'people_standard_cost_unavailable' })
  }
  const workCalendarMonth = workCalendarResult.status === 'fulfilled' && workCalendarResult.value
    ? workCalendarResult.value
    : {}
  if (workCalendarResult.status === 'rejected') {
    additionalReasons.push({ code: 'work_calendar_unavailable' })
  }
  const plan = buildProjectLaborCostPlan({
    projectCode,
    periodMonth,
    projectTimeEntries,
    costParameters,
    peopleStandardCosts,
    workCalendarMonth,
    additionalReasons
  })
  const command = buildProjectLaborCostSyncCommand({
    projectCode,
    periodMonth,
    projectId,
    calculatedBy,
    expectedInputHash,
    costParameters,
    workCalendarMonth,
    plan
  })
  const domainSync = (await postFinanceRuntime<RuntimeRow>(
    event,
    '/v1/finance/project-accounting/labor-costs:sync',
    command
  )) || {}

  return {
    code: 0,
    data: {
      projectCode,
      periodMonth,
      aimsProjectId: projectId,
      aimsTimeEntryRows: projectTimeEntries.length,
      projectMemberRows: plan.employeeUids.length,
      peopleStandardCostRows: peopleStandardCosts.items?.length || 0,
      employeeStandardCostsSynced: Number(domainSync.employeeCostSnapshotsUpserted || 0),
      laborCostAllocationsSynced: Number(domainSync.laborAllocationsUpserted || 0),
      laborCostAllocationsReversed: Number(domainSync.laborAllocationsReversed || 0),
      totalAllocatedCost: plan.items.reduce((sum, item) => sum + item.allocatedCost, 0).toFixed(2),
      totalAllocatedActualCost: plan.items.reduce((sum, item) => sum + item.allocatedCost, 0).toFixed(2),
      readinessStatus: plan.status,
      readinessReasons: plan.reasons,
      skipped: plan.reasons,
      inputHash: text(domainSync.inputHash),
      idempotentReplay: Boolean(domainSync.idempotentReplay),
      domainSync
    }
  }
})
