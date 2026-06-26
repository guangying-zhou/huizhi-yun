import { createError, defineEventHandler, getHeader, readBody, type H3Event } from 'h3'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import {
  buildFinanceRuntimeAuthBody,
  buildFinanceRuntimeAuthQuery,
  maybeCallFinanceDataRuntime
} from '../../../../utils/dataRuntime'

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

interface StandardCostComponents {
  baseSalary: number
  rankSalary: number
  performanceSalaryMin: number
  performanceSalaryMax: number
  performanceSalaryMidpoint: number
  welfareCost: number
  managementAllocation: number
  resourceAllocation: number
  monthlyStandardCost: number
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
  if (!access || access === 'all') return
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

function numberValue(value: unknown) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function amountString(value: unknown) {
  return numberValue(value).toFixed(2)
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function appendPath(baseUrl: string, path: string) {
  return `${trimTrailingSlash(baseUrl)}/${path.replace(/^\/+/, '')}`
}

function forwardedContextHeaders(event: H3Event) {
  const headers: Record<string, string> = {}
  for (const name of [
    'x-hzy-gateway',
    'x-hzy-gateway-token',
    'x-hzy-tenant',
    'x-hzy-deployment',
    'x-hzy-environment',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-prefix',
    'x-forwarded-proto'
  ]) {
    const value = text(getHeader(event, name))
    if (value) headers[name] = value
  }
  const requestId = text(getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id'))
  if (requestId) headers['x-request-id'] = requestId
  return headers
}

function ratioValue(projectHours: number, totalHours: number) {
  if (totalHours <= 0) return 0
  return Number((projectHours / totalHours).toFixed(4))
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

function stableAllocationCode(projectCode: string, periodMonth: string, employeeUid: string) {
  const source = `${projectCode}:${periodMonth}:${employeeUid}:aims-workload-standard-cost-v1`
  let hash = 2166136261
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const hashPart = (hash >>> 0).toString(36).toUpperCase().padStart(7, '0')
  return `PCL${periodMonth.replace('-', '')}${hashPart}`
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
        ...forwardedContextHeaders(event),
        authorization: `Bearer ${token}`
      },
      timeout: 10000
    }
  )
  return unwrapRuntimeEnvelope(response, 'Console work calendar returned an error.')
}

function aggregateHours(entries: RuntimeRow[]) {
  const byEmployee = new Map<string, number>()
  for (const entry of entries) {
    const employeeUid = text(entry.uid || entry.employee_uid || entry.employeeUid)
    if (!employeeUid) continue
    byEmployee.set(employeeUid, (byEmployee.get(employeeUid) || 0) + numberValue(entry.hours))
  }
  return byEmployee
}

function uniqueEmployeeUids(hoursByEmployee: Map<string, number>) {
  return [...hoursByEmployee.entries()]
    .filter(([, hours]) => hours > 0)
    .map(([employeeUid]) => employeeUid)
    .sort()
}

function standardCostByEmployee(resolution: PeopleStandardCostResolution) {
  const map = new Map<string, RuntimeRow>()
  for (const item of resolution.items || []) {
    const employeeUid = text(item.employee_uid || item.employeeUid)
    if (employeeUid) map.set(employeeUid, item)
  }
  return map
}

function financeCostComponents(rate: RuntimeRow, parameters: RuntimeRow): StandardCostComponents {
  const baseSalary = numberValue(parameters.base_salary || parameters.baseSalary)
  const rankSalary = numberValue(rate.rank_salary || rate.rankSalary)
  const performanceSalaryMin = numberValue(rate.performance_salary_min || rate.performanceSalaryMin)
  const performanceSalaryMax = numberValue(rate.performance_salary_max || rate.performanceSalaryMax)
  const performanceSalaryMidpoint = performanceSalaryMin || performanceSalaryMax
    ? (performanceSalaryMin + performanceSalaryMax) / 2
    : 0
  const welfareCost = (baseSalary + rankSalary + performanceSalaryMidpoint) * numberValue(parameters.welfare_cost_rate || parameters.welfareCostRate)
  const managementAllocation = (baseSalary + rankSalary + performanceSalaryMidpoint + welfareCost)
    * numberValue(parameters.management_allocation_rate || parameters.managementAllocationRate)
  const resourceAllocation = numberValue(parameters.resource_allocation_cost || parameters.resourceAllocationCost)
  const monthlyStandardCost = baseSalary + rankSalary + performanceSalaryMidpoint + welfareCost + managementAllocation + resourceAllocation
  return {
    baseSalary,
    rankSalary,
    performanceSalaryMin,
    performanceSalaryMax,
    performanceSalaryMidpoint,
    welfareCost,
    managementAllocation,
    resourceAllocation,
    monthlyStandardCost
  }
}

export default defineEventHandler(async (event) => {
  const body = ((await readBody<RuntimeRow>(event).catch(() => ({} as RuntimeRow))) || {}) as RuntimeRow
  const projectCode = requireProjectCode(body)
  const periodMonth = normalizePeriodMonth(body.periodMonth || body.period_month)
  const calculatedBy = text(body.calculatedBy || body.calculated_by) || 'finance.standard-labor-cost-sync'
  const { startDate, endDate } = monthRange(periodMonth)
  await assertProjectFinanceWriteAccess(event, projectCode)

  const project = await fetchAimsProject(event, projectCode)
  const projectId = text(project.id)
  const projectTimeEntries = await fetchAimsProjectTimeEntries(event, projectId, startDate, endDate)
  const projectHoursByEmployee = aggregateHours(projectTimeEntries)
  const employeeUids = uniqueEmployeeUids(projectHoursByEmployee)
  const [costParameters, peopleStandardCosts, workCalendarMonth] = await Promise.all([
    callFinanceRuntime<RuntimeRow>(event, '/v1/finance/service/people-cost-parameters', { effective_date: endDate }),
    fetchPeopleStandardCosts(event, employeeUids, endDate),
    fetchConsoleWorkCalendarMonth(event, periodMonth)
  ])
  const standardWorkHours = numberValue(workCalendarMonth.standardWorkHours)
  if (standardWorkHours <= 0) {
    throw createError({ statusCode: 409, message: `Console work calendar has no standardWorkHours for ${periodMonth}.` })
  }

  const standardCostMap = standardCostByEmployee(peopleStandardCosts)
  const skipped: Array<{ employeeUid?: string, reason: string }> = []
  let employeeStandardCostsSynced = 0
  let laborCostAllocationsSynced = 0
  let totalAllocatedCost = 0

  for (const employeeUid of employeeUids) {
    const projectHours = projectHoursByEmployee.get(employeeUid) || 0
    if (projectHours <= 0) {
      skipped.push({ employeeUid, reason: 'missing_project_hours' })
      continue
    }

    const standardCost = standardCostMap.get(employeeUid)
    const rate = (standardCost?.standard_rate || standardCost?.standardRate) as RuntimeRow | undefined
    if (!standardCost || !rate) {
      skipped.push({ employeeUid, reason: 'missing_people_rank_standard_cost' })
      continue
    }

    const components = financeCostComponents(rate, costParameters)
    if (components.monthlyStandardCost <= 0) {
      skipped.push({ employeeUid, reason: 'invalid_monthly_standard_cost' })
      continue
    }

    const allocationRatio = ratioValue(projectHours, standardWorkHours)
    const allocatedCost = components.monthlyStandardCost * allocationRatio
    const sourceRefs = {
      sourceApp: 'finance',
      projectCode,
      periodMonth,
      costBasis: 'standard',
      calculationRule: 'aims_workload_standard_cost_calendar_hours_v1',
      aims: {
        projectId,
        projectHours,
        allocationRatio
      },
      workCalendar: {
        calendarCode: text(workCalendarMonth.calendarCode || 'CN'),
        yearMonth: text(workCalendarMonth.yearMonth || periodMonth),
        workdayCount: numberValue(workCalendarMonth.workdayCount),
        standardHoursPerDay: numberValue(workCalendarMonth.standardHoursPerDay),
        standardWorkHours,
        source: text(workCalendarMonth.source),
        calculatedAt: text(workCalendarMonth.calculatedAt)
      },
      people: {
        employeeUid,
        rankCode: text(standardCost.rank_code || standardCost.rankCode),
        rankName: text(standardCost.rank_name || standardCost.rankName),
        rankSource: text(standardCost.rank_source || standardCost.rankSource),
        standardRateCode: text(rate.rate_code || rate.rateCode),
        standardRateName: text(rate.rate_name || rate.rateName)
      },
      financeCostParameters: {
        code: text(costParameters.code || costParameters.parameter_code || costParameters.parameterCode),
        effectiveDate: endDate,
        baseSalary: components.baseSalary,
        welfareCostRate: numberValue(costParameters.welfare_cost_rate || costParameters.welfareCostRate),
        managementAllocationRate: numberValue(costParameters.management_allocation_rate || costParameters.managementAllocationRate),
        resourceAllocationCost: components.resourceAllocation
      },
      components
    }

    await postFinanceRuntime<RuntimeRow>(event, '/v1/finance/employee-costs', {
      employeeUid,
      employeeName: text(standardCost.employee_name || standardCost.employeeName),
      deptCode: text(standardCost.dept_code || standardCost.deptCode),
      positionCode: text(standardCost.position_code || standardCost.positionCode),
      rankCode: text(standardCost.rank_code || standardCost.rankCode),
      periodMonth,
      standardCostAmount: amountString(components.monthlyStandardCost),
      costSource: 'people_standard_cost',
      sourceRefs
    }, { trustProjectScopedEmployeeCostWrite: true })
    employeeStandardCostsSynced++

    await postFinanceRuntime<RuntimeRow>(event, '/v1/finance/project-cost-allocations', {
      code: stableAllocationCode(projectCode, periodMonth, employeeUid),
      projectCode,
      periodMonth,
      allocationType: 'labor',
      sourceTable: 'aims_time_entries_people_standard_cost_work_calendar',
      employeeUid,
      amount: amountString(allocatedCost),
      allocationBasis: 'calendar_month_standard_hour_ratio',
      basisValue: allocationRatio,
      ruleCode: 'std_labor_calendar_hours_v1',
      status: 'active',
      createdBy: calculatedBy
    })
    laborCostAllocationsSynced++
    totalAllocatedCost += allocatedCost
  }

  const recalculated = await postFinanceRuntime<RuntimeRow>(event, '/v1/finance/project-accounting/recalculate', {
    projectCode,
    periodMonth,
    calculatedBy
  })

  return {
    code: 0,
    data: {
      projectCode,
      periodMonth,
      aimsProjectId: projectId,
      aimsTimeEntryRows: projectTimeEntries.length,
      projectMemberRows: employeeUids.length,
      peopleStandardCostRows: peopleStandardCosts.items?.length || 0,
      employeeStandardCostsSynced,
      laborCostAllocationsSynced,
      totalAllocatedCost: totalAllocatedCost.toFixed(2),
      totalAllocatedActualCost: totalAllocatedCost.toFixed(2),
      skipped: [
        ...(peopleStandardCosts.skipped || []).map(item => ({
          employeeUid: text(item.employee_uid || item.employeeUid),
          reason: text(item.reason) || 'people_standard_cost_unresolved'
        })),
        ...skipped
      ],
      recalculations: [{ periodMonth, result: recalculated }]
    }
  }
})
