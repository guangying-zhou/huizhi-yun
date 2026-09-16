export type RuntimeRow = Record<string, unknown>

export interface PeopleStandardCostResolution {
  items?: RuntimeRow[]
  skipped?: Array<{ employee_uid?: string, employeeUid?: string, reason?: string }>
}

export interface WorkCalendarMonth {
  calendarCode?: string
  yearMonth?: string
  workdayCount?: number
  standardHoursPerDay?: number
  standardWorkHours?: number
  source?: string
  calculatedAt?: string
}

export interface StandardCostComponents {
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

export interface LaborCostReadinessReason {
  code: string
  employeeUid?: string
}

interface ProjectLaborCostPlanInput {
  projectCode: string
  periodMonth: string
  projectTimeEntries: RuntimeRow[]
  costParameters: RuntimeRow
  peopleStandardCosts: PeopleStandardCostResolution
  workCalendarMonth: WorkCalendarMonth
  additionalReasons?: LaborCostReadinessReason[]
}

interface ProjectLaborCostSyncCommandInput {
  projectCode: string
  periodMonth: string
  projectId: string
  calculatedBy: string
  expectedInputHash: string | null
  costParameters: RuntimeRow
  workCalendarMonth: WorkCalendarMonth
  plan: ReturnType<typeof buildProjectLaborCostPlan>
}

function text(value: unknown) {
  return String(value || '').trim()
}

// Preserve explicit source evidence only. Missing or malformed currency is not
// proof of CNY, and a parameter currency alone cannot establish the currency of
// the People rank salary included in the same calculated amount.
function sourceCurrencyCode(row: RuntimeRow, source: 'finance' | 'people'): string | null {
  const value = source === 'people' ? row.currency : row.currency_code ?? row.currencyCode
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null
}

export function numberValue(value: unknown) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

export function ratioValue(projectHours: number, totalHours: number) {
  if (totalHours <= 0) return 0
  return Number((projectHours / totalHours).toFixed(4))
}

export function aggregateHours(entries: RuntimeRow[]) {
  const byEmployee = new Map<string, number>()
  for (const entry of entries) {
    const employeeUid = text(entry.uid || entry.employee_uid || entry.employeeUid)
    if (!employeeUid) continue
    byEmployee.set(employeeUid, (byEmployee.get(employeeUid) || 0) + numberValue(entry.hours))
  }
  return byEmployee
}

export function financeCostComponents(rate: RuntimeRow, parameters: RuntimeRow): StandardCostComponents {
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

function standardCostByEmployee(resolution: PeopleStandardCostResolution) {
  const map = new Map<string, RuntimeRow>()
  for (const item of resolution.items || []) {
    const employeeUid = text(item.employee_uid || item.employeeUid)
    if (employeeUid) map.set(employeeUid, item)
  }
  return map
}

function addReason(reasons: LaborCostReadinessReason[], reason: LaborCostReadinessReason) {
  if (!reasons.some(item => item.code === reason.code && item.employeeUid === reason.employeeUid)) {
    reasons.push(reason)
  }
}

export function buildProjectLaborCostPlan(input: ProjectLaborCostPlanInput) {
  const hoursByEmployee = aggregateHours(input.projectTimeEntries)
  const employeeUids = [...hoursByEmployee.entries()]
    .filter(([, hours]) => hours > 0)
    .map(([employeeUid]) => employeeUid)
    .sort()
  const standardWorkHours = numberValue(input.workCalendarMonth.standardWorkHours)
  const standardCostMap = standardCostByEmployee(input.peopleStandardCosts)
  const reasons: LaborCostReadinessReason[] = []

  for (const reason of input.additionalReasons || []) addReason(reasons, reason)

  if (employeeUids.length === 0) addReason(reasons, { code: 'missing_aims_time_entries' })
  if (!text(input.costParameters.code || input.costParameters.parameter_code || input.costParameters.parameterCode)) {
    addReason(reasons, { code: 'missing_finance_cost_parameters' })
  }
  if (standardWorkHours <= 0) addReason(reasons, { code: 'missing_work_calendar' })
  for (const skipped of input.peopleStandardCosts.skipped || []) {
    addReason(reasons, {
      code: text(skipped.reason) || 'missing_people_rank_standard_cost',
      employeeUid: text(skipped.employee_uid || skipped.employeeUid) || undefined
    })
  }

  const items = employeeUids.flatMap((employeeUid) => {
    const standardCost = standardCostMap.get(employeeUid)
    const rate = (standardCost?.standard_rate || standardCost?.standardRate) as RuntimeRow | undefined
    if (!standardCost || !rate) {
      addReason(reasons, { code: 'missing_people_rank_standard_cost', employeeUid })
      return []
    }
    const components = financeCostComponents(rate, input.costParameters)
    if (components.monthlyStandardCost <= 0) {
      addReason(reasons, { code: 'invalid_monthly_standard_cost', employeeUid })
      return []
    }
    const projectHours = hoursByEmployee.get(employeeUid) || 0
    const allocationRatio = ratioValue(projectHours, standardWorkHours)
    return [{
      employeeUid,
      projectHours,
      standardCost,
      rate,
      components,
      allocationRatio,
      allocatedCost: components.monthlyStandardCost * allocationRatio
    }]
  })

  return {
    ready: reasons.length === 0,
    status: reasons.length === 0 ? 'ready' : 'not_ready',
    reasons,
    employeeUids,
    standardWorkHours,
    items
  } as const
}

export function buildProjectLaborCostSyncCommand(input: ProjectLaborCostSyncCommandInput) {
  const parameterCode = text(input.costParameters.code || input.costParameters.parameter_code || input.costParameters.parameterCode)
  const canAllocate = input.plan.standardWorkHours > 0 && Boolean(parameterCode)
  return {
    projectCode: input.projectCode,
    periodMonth: input.periodMonth,
    expectedInputHash: input.expectedInputHash,
    readinessStatus: input.plan.status,
    missingInputs: input.plan.reasons,
    calculationRule: 'std_labor_calendar_hours_v1',
    calculatedBy: input.calculatedBy,
    laborItems: canAllocate
      ? input.plan.items.map((item) => {
          const standardCost = item.standardCost
          const rate = item.rate
          const workCalendar = {
            calendarCode: text(input.workCalendarMonth.calendarCode || 'CN'),
            yearMonth: text(input.workCalendarMonth.yearMonth || input.periodMonth),
            workdayCount: numberValue(input.workCalendarMonth.workdayCount),
            standardHoursPerDay: numberValue(input.workCalendarMonth.standardHoursPerDay),
            standardWorkHours: input.plan.standardWorkHours,
            source: text(input.workCalendarMonth.source),
            calculatedAt: text(input.workCalendarMonth.calculatedAt)
          }
          const people = {
            employeeUid: item.employeeUid,
            rankCode: text(standardCost.rank_code || standardCost.rankCode),
            rankName: text(standardCost.rank_name || standardCost.rankName),
            rankSource: text(standardCost.rank_source || standardCost.rankSource),
            standardRateCode: text(rate.rate_code || rate.rateCode),
            standardRateName: text(rate.rate_name || rate.rateName),
            standardRateCurrencyCode: sourceCurrencyCode(rate, 'people')
          }
          const financeCostParameters = {
            code: parameterCode,
            currencyCode: sourceCurrencyCode(input.costParameters, 'finance'),
            effectiveDate: `${input.periodMonth}-01`,
            baseSalary: item.components.baseSalary,
            welfareCostRate: numberValue(input.costParameters.welfare_cost_rate || input.costParameters.welfareCostRate),
            managementAllocationRate: numberValue(input.costParameters.management_allocation_rate || input.costParameters.managementAllocationRate),
            resourceAllocationCost: item.components.resourceAllocation
          }
          return {
            employeeUid: item.employeeUid,
            employeeName: text(standardCost.employee_name || standardCost.employeeName),
            deptCode: text(standardCost.dept_code || standardCost.deptCode),
            positionCode: text(standardCost.position_code || standardCost.positionCode),
            rankCode: text(standardCost.rank_code || standardCost.rankCode),
            standardCostAmount: item.components.monthlyStandardCost.toFixed(2),
            projectHours: item.projectHours.toFixed(4),
            standardWorkHours: input.plan.standardWorkHours.toFixed(4),
            allocationRatio: item.allocationRatio.toFixed(4),
            allocatedCostAmount: item.allocatedCost.toFixed(2),
            employeeSourceRefs: {
              sourceApp: 'finance',
              periodMonth: input.periodMonth,
              costBasis: 'standard',
              workCalendar,
              people,
              financeCostParameters,
              components: item.components
            },
            allocationSourceRefs: {
              sourceApp: 'finance',
              projectCode: input.projectCode,
              periodMonth: input.periodMonth,
              costBasis: 'standard',
              calculationRule: 'aims_workload_standard_cost_calendar_hours_v1',
              aims: {
                projectId: input.projectId,
                projectHours: item.projectHours,
                allocationRatio: item.allocationRatio
              },
              workCalendar,
              people,
              financeCostParameters,
              components: item.components
            }
          }
        })
      : []
  }
}
