import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildProjectLaborCostPlan,
  buildProjectLaborCostSyncCommand
} from '../server/utils/projectPeopleCostSync.ts'
import { mergeProjectWithFinance } from '../server/utils/projectAccountingReadiness.ts'

const baseInput = {
  projectCode: 'PRJ-1',
  periodMonth: '2026-07',
  projectTimeEntries: [
    { id: 1, uid: 'u-1', hours: 40 },
    { id: 2, uid: 'u-1', hours: 40 }
  ],
  costParameters: {
    code: 'PARAM-1',
    base_salary: 8000,
    welfare_cost_rate: 0.1,
    management_allocation_rate: 0.05,
    resource_allocation_cost: 500
  },
  peopleStandardCosts: {
    items: [{
      employee_uid: 'u-1',
      rank_code: 'P6',
      standard_rate: {
        rate_code: 'RATE-P6',
        rank_salary: 2000,
        performance_salary_min: 1000,
        performance_salary_max: 3000
      }
    }],
    skipped: []
  },
  workCalendarMonth: { standardWorkHours: 160 }
}

describe('project People standard cost planning', () => {
  test('preserves independent currency evidence without inventing a combined cost currency', () => {
    const build = (parameterCurrency: unknown, rankCurrency: unknown) => {
      const input = {
        ...baseInput,
        costParameters: { ...baseInput.costParameters, currency_code: parameterCurrency },
        peopleStandardCosts: {
          items: [{
            ...baseInput.peopleStandardCosts.items[0],
            standard_rate: { ...baseInput.peopleStandardCosts.items[0]!.standard_rate, currency: rankCurrency }
          }],
          skipped: []
        }
      }
      return buildProjectLaborCostSyncCommand({
        projectCode: input.projectCode, periodMonth: input.periodMonth,
        projectId: '42', calculatedBy: 'tester', expectedInputHash: null,
        costParameters: input.costParameters, workCalendarMonth: input.workCalendarMonth,
        plan: buildProjectLaborCostPlan(input)
      }).laborItems[0]!
    }
    const mixed = build('CNY', 'USD')
    assert.equal(mixed.allocationSourceRefs.financeCostParameters.currencyCode, 'CNY')
    assert.equal(mixed.allocationSourceRefs.people.standardRateCurrencyCode, 'USD')
    assert.deepEqual(mixed.employeeSourceRefs.financeCostParameters, mixed.allocationSourceRefs.financeCostParameters)
    assert.deepEqual(mixed.employeeSourceRefs.people, mixed.allocationSourceRefs.people)
    assert.equal('currencyCode' in mixed.allocationSourceRefs, false)
    for (const invalid of [undefined, null, '', 'cny', ' CNY', 'CNY/USD', 156]) {
      const item = build(invalid, invalid)
      assert.equal(item.allocationSourceRefs.financeCostParameters.currencyCode, null)
      assert.equal(item.allocationSourceRefs.people.standardRateCurrencyCode, null)
    }
  })

  test('calculates exact monthly and allocated costs', () => {
    const plan = buildProjectLaborCostPlan(baseInput)
    assert.equal(plan.ready, true)
    assert.equal(plan.items.length, 1)
    assert.equal(plan.items[0]?.components.monthlyStandardCost, 14360)
    assert.equal(plan.items[0]?.allocationRatio, 0.5)
    assert.equal(plan.items[0]?.allocatedCost, 7180)
  })

  test('fails closed before writes when rank, calendar, parameters or Aims time are missing', () => {
    const cases = [
      {
        input: { ...baseInput, peopleStandardCosts: { items: [], skipped: [] } },
        reason: 'missing_people_rank_standard_cost'
      },
      {
        input: { ...baseInput, workCalendarMonth: { standardWorkHours: 0 } },
        reason: 'missing_work_calendar'
      },
      {
        input: { ...baseInput, costParameters: {} },
        reason: 'missing_finance_cost_parameters'
      },
      {
        input: { ...baseInput, projectTimeEntries: [] },
        reason: 'missing_aims_time_entries'
      }
    ]

    for (const item of cases) {
      const plan = buildProjectLaborCostPlan(item.input)
      assert.equal(plan.ready, false)
      assert.equal(plan.status, 'not_ready')
      assert.ok(plan.reasons.some(reason => reason.code === item.reason))
    }
  })

  test('checks the complete readiness plan before any Finance write or summary recalculation', () => {
    const route = readFileSync(
      new URL('../server/api/v1/finance/project-accounting/sync-people-costs.post.ts', import.meta.url),
      'utf8'
    )
    assert.match(route, /Promise\.allSettled/)
    assert.match(route, /buildProjectLaborCostSyncCommand/)
    assert.match(route, /\/v1\/finance\/project-accounting\/labor-costs:sync/)
    assert.doesNotMatch(route, /postFinanceRuntime<RuntimeRow>\(event, '\/v1\/finance\/employee-costs'/)
    assert.doesNotMatch(route, /postFinanceRuntime<RuntimeRow>\(event, '\/v1\/finance\/project-cost-allocations'/)
    assert.doesNotMatch(route, /postFinanceRuntime<RuntimeRow>\(event, '\/v1\/finance\/project-accounting\/recalculate'/)
    assert.doesNotMatch(route, /!access\s*\|\|/)
  })

  test('builds one exact runtime command for ready inputs', () => {
    const plan = buildProjectLaborCostPlan(baseInput)
    const command = buildProjectLaborCostSyncCommand({
      projectCode: 'PRJ-1',
      periodMonth: '2026-07',
      projectId: '42',
      calculatedBy: 'tester',
      expectedInputHash: null,
      costParameters: baseInput.costParameters,
      workCalendarMonth: { calendarCode: 'CN', yearMonth: '2026-07', standardWorkHours: 160 },
      plan
    })
    assert.equal(command.readinessStatus, 'ready')
    assert.equal(command.laborItems.length, 1)
    assert.equal(command.laborItems[0]?.standardCostAmount, '14360.00')
    assert.equal(command.laborItems[0]?.allocatedCostAmount, '7180.00')
    assert.equal(command.laborItems[0]?.allocationRatio, '0.5000')
    assert.equal(command.expectedInputHash, null)
  })

  test('builds a not-ready invalidation command when the calendar is unavailable', () => {
    const plan = buildProjectLaborCostPlan({
      ...baseInput,
      workCalendarMonth: {},
      additionalReasons: [{ code: 'work_calendar_unavailable' }]
    })
    const command = buildProjectLaborCostSyncCommand({
      projectCode: 'PRJ-1',
      periodMonth: '2026-07',
      projectId: '42',
      calculatedBy: 'tester',
      expectedInputHash: 'a'.repeat(64),
      costParameters: baseInput.costParameters,
      workCalendarMonth: {},
      plan
    })
    assert.equal(command.readinessStatus, 'not_ready')
    assert.equal(command.laborItems.length, 0)
    assert.ok(command.missingInputs.some(item => item.code === 'missing_work_calendar'))
    assert.ok(command.missingInputs.some(item => item.code === 'work_calendar_unavailable'))
  })
})

describe('project accounting readiness projection', () => {
  test('hides stale gross profit and margin while labor cost is not ready', () => {
    const row = mergeProjectWithFinance(
      { id: 1, project_code: 'PRJ-1', name: 'Project' },
      { received_amount: '10000.00', direct_expense_amount: '1000.00', gross_profit_amount: '9000.00', gross_margin_rate: '0.9000' },
      '2026-07',
      0
    )

    assert.equal(row.cost_status, 'cost_pending')
    assert.equal(row.cost_status_label, '人力成本未就绪')
    assert.equal(row.gross_profit_amount, null)
    assert.equal(row.gross_margin_rate, null)
  })

  test('shows complete gross profit only after labor allocation is ready', () => {
    const row = mergeProjectWithFinance(
      { id: 1, project_code: 'PRJ-1', name: 'Project' },
      {
        received_amount: '10000.00',
        direct_expense_amount: '1000.00',
        allocated_cost_amount: '500.00',
        labor_cost_amount: '2000.00',
        gross_profit_amount: '6500.00',
        cost_readiness_status: 'ready'
      },
      '2026-07',
      2000
    )

    assert.equal(row.cost_status, 'cost_ready')
    assert.equal(row.gross_profit_amount, '6500.00')
  })

  test('fails closed for legacy positive labor and gross without persisted readiness', () => {
    const row = mergeProjectWithFinance(
      { id: 1, project_code: 'PRJ-1', name: 'Project' },
      { labor_cost_amount: '2000.00', gross_profit_amount: '7000.00' },
      '2026-07',
      2000
    )
    assert.equal(row.cost_status, 'cost_pending')
    assert.equal(row.gross_profit_amount, null)
  })
})
