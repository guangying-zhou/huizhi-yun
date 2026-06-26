import type { RowDataPacket } from '~~/server/utils/db'
import { execute, queryRows } from './db'
import { missingSchemaWarning } from './financeApi'
import { cleanString, generateFinanceCode, optionalDate, type SqlParam } from './financeWrite'

type RecalculateOptions = {
  projectCode?: string | null
  employeeUid?: string | null
  periodMonth?: string | null
  calculatedBy?: string | null
}

type RecalculateResult = {
  recalculated: number
  warning?: string
}

type ProjectMetricRow = RowDataPacket & {
  project_code: string
  period_month: string
  customer_code: string | null
  contract_code: string | null
  contract_amount: string | null
  invoice_amount: string | null
  received_amount: string | null
  direct_expense_amount: string | null
  labor_cost_amount: string | null
  allocated_cost_amount: string | null
}

type PerformanceMetricRow = RowDataPacket & {
  employee_uid: string
  employee_name: string | null
  dept_code: string | null
  period_month: string
  base_amount: string | null
}

export async function recalculateProjectFinance(options: RecalculateOptions = {}): Promise<RecalculateResult> {
  const params = projectMetricParams(options)

  try {
    const rows = await queryRows<ProjectMetricRow[]>(projectMetricSql(Boolean(options.projectCode), Boolean(options.periodMonth)), params)
    for (const row of rows) {
      const receivedAmount = Number(row.received_amount || 0)
      const directExpenseAmount = Number(row.direct_expense_amount || 0)
      const laborCostAmount = Number(row.labor_cost_amount || 0)
      const allocatedCostAmount = Number(row.allocated_cost_amount || 0)
      const grossProfitAmount = receivedAmount - directExpenseAmount - laborCostAmount - allocatedCostAmount
      const grossMarginRate = receivedAmount > 0 ? grossProfitAmount / receivedAmount : null

      await execute(`
        INSERT INTO project_finance_summary (
          project_code,
          project_name,
          customer_code,
          contract_code,
          period_month,
          contract_amount,
          invoice_amount,
          received_amount,
          direct_expense_amount,
          labor_cost_amount,
          allocated_cost_amount,
          gross_profit_amount,
          gross_margin_rate,
          calculated_at,
          calculation_source,
          snapshot_json
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'system', ?)
        ON DUPLICATE KEY UPDATE
          customer_code = VALUES(customer_code),
          contract_code = VALUES(contract_code),
          contract_amount = VALUES(contract_amount),
          invoice_amount = VALUES(invoice_amount),
          received_amount = VALUES(received_amount),
          direct_expense_amount = VALUES(direct_expense_amount),
          labor_cost_amount = VALUES(labor_cost_amount),
          allocated_cost_amount = VALUES(allocated_cost_amount),
          gross_profit_amount = VALUES(gross_profit_amount),
          gross_margin_rate = VALUES(gross_margin_rate),
          calculated_at = NOW(),
          calculation_source = 'system',
          snapshot_json = VALUES(snapshot_json)
      `, [
        row.project_code,
        row.customer_code || null,
        row.contract_code || null,
        row.period_month,
        amount(row.contract_amount),
        amount(row.invoice_amount),
        receivedAmount.toFixed(2),
        directExpenseAmount.toFixed(2),
        laborCostAmount.toFixed(2),
        allocatedCostAmount.toFixed(2),
        grossProfitAmount.toFixed(2),
        grossMarginRate === null ? null : grossMarginRate.toFixed(4),
        JSON.stringify({
          source: 'finance.recalculateProjectFinance',
          projectCode: row.project_code,
          periodMonth: row.period_month,
          metrics: {
            contractAmount: amount(row.contract_amount),
            invoiceAmount: amount(row.invoice_amount),
            receivedAmount: receivedAmount.toFixed(2),
            directExpenseAmount: directExpenseAmount.toFixed(2),
            laborCostAmount: laborCostAmount.toFixed(2),
            allocatedCostAmount: allocatedCostAmount.toFixed(2),
            grossProfitAmount: grossProfitAmount.toFixed(2),
            grossMarginRate
          }
        })
      ] satisfies SqlParam[])
    }

    return { recalculated: rows.length }
  } catch (error) {
    const warning = missingSchemaWarning(error)
    if (!warning) throw error
    return { recalculated: 0, warning }
  }
}

export async function recalculateEmployeePerformance(options: RecalculateOptions = {}): Promise<RecalculateResult> {
  const params = performanceMetricParams(options)

  try {
    const rows = await queryRows<PerformanceMetricRow[]>(
      performanceMetricSql(Boolean(options.employeeUid), Boolean(options.periodMonth)),
      params
    )
    for (const row of rows) {
      const baseAmount = Number(row.base_amount || 0)
      const performanceAmount = baseAmount
      const code = performanceCode(row.employee_uid, row.period_month)
      const snapshot = {
        source: 'finance.recalculateEmployeePerformance',
        employeeUid: row.employee_uid,
        periodMonth: row.period_month,
        baseAmount: baseAmount.toFixed(2),
        performanceAmount: performanceAmount.toFixed(2)
      }

      await execute(`
        INSERT INTO employee_finance_performance (
          code,
          employee_uid,
          employee_name,
          dept_code,
          period_month,
          performance_type,
          base_amount,
          performance_amount,
          performance_score,
          status,
          calculated_at,
          calculation_snapshot_json,
          created_by,
          updated_by
        ) VALUES (?, ?, ?, ?, ?, 'commission', ?, ?, NULL, 'calculated', NOW(), ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          employee_name = VALUES(employee_name),
          dept_code = VALUES(dept_code),
          base_amount = VALUES(base_amount),
          performance_amount = VALUES(performance_amount),
          status = 'calculated',
          calculated_at = NOW(),
          calculation_snapshot_json = VALUES(calculation_snapshot_json),
          updated_by = VALUES(updated_by)
      `, [
        code,
        row.employee_uid,
        row.employee_name || null,
        row.dept_code || null,
        row.period_month,
        baseAmount.toFixed(2),
        performanceAmount.toFixed(2),
        JSON.stringify(snapshot),
        cleanString(options.calculatedBy) || 'finance-system',
        cleanString(options.calculatedBy) || 'finance-system'
      ] satisfies SqlParam[])

      await execute(`
        INSERT INTO performance_calculation_snapshot (
          code,
          period_month,
          calculation_type,
          target_type,
          target_code,
          input_hash,
          result_json,
          calculated_by,
          calculated_at
        ) VALUES (?, ?, 'employee', 'employee', ?, SHA2(?, 256), ?, ?, NOW())
      `, [
        generateFinanceCode('PCS'),
        row.period_month,
        row.employee_uid,
        JSON.stringify(snapshot),
        JSON.stringify(snapshot),
        cleanString(options.calculatedBy) || 'finance-system'
      ] satisfies SqlParam[])
    }

    return { recalculated: rows.length }
  } catch (error) {
    const warning = missingSchemaWarning(error)
    if (!warning) throw error
    return { recalculated: 0, warning }
  }
}

export function periodMonth(value: unknown): string {
  const text = cleanString(value) || new Date().toISOString().slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(text)) {
    throw new Error('periodMonth must be YYYY-MM')
  }
  return text
}

export function monthDate(value: unknown): string | null {
  return optionalDate(value ? `${value}-01` : null)
}

function amount(value: string | null) {
  return Number(value || 0).toFixed(2)
}

function performanceCode(employeeUid: string, month: string) {
  const normalized = `${employeeUid}:${month}`
  let hash = 0
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0
  }
  return `PERF${month.replace('-', '')}${Math.abs(hash).toString(36).toUpperCase().padStart(6, '0')}`.slice(0, 50)
}

function projectMetricParams(options: RecalculateOptions) {
  const params: SqlParam[] = []
  if (options.projectCode) params.push(options.projectCode)
  if (options.periodMonth) params.push(options.periodMonth)
  return params
}

function performanceMetricParams(options: RecalculateOptions) {
  const params: SqlParam[] = []
  if (options.employeeUid) params.push(options.employeeUid)
  if (options.periodMonth) params.push(options.periodMonth)
  return params
}

function projectMetricSql(hasProjectFilter: boolean, hasPeriodFilter: boolean) {
  const where = [
    'metric.project_code IS NOT NULL',
    hasProjectFilter ? 'metric.project_code = ?' : '',
    hasPeriodFilter ? 'metric.period_month = ?' : ''
  ].filter(Boolean).join(' AND ')

  return `
    SELECT
      metric.project_code,
      metric.period_month,
      MAX(metric.customer_code) AS customer_code,
      MAX(metric.contract_code) AS contract_code,
      SUM(metric.contract_amount) AS contract_amount,
      SUM(metric.invoice_amount) AS invoice_amount,
      SUM(metric.received_amount) AS received_amount,
      SUM(metric.direct_expense_amount) AS direct_expense_amount,
      SUM(metric.labor_cost_amount) AS labor_cost_amount,
      SUM(metric.allocated_cost_amount) AS allocated_cost_amount
    FROM (
      SELECT project_code, DATE_FORMAT(invoice_date, '%Y-%m') AS period_month, customer_code, contract_code,
             0 AS contract_amount, SUM(invoice_amount) AS invoice_amount, 0 AS received_amount,
             0 AS direct_expense_amount, 0 AS labor_cost_amount, 0 AS allocated_cost_amount
      FROM finance_invoice
      WHERE deleted_at IS NULL AND status <> 'canceled' AND project_code IS NOT NULL
      GROUP BY project_code, DATE_FORMAT(invoice_date, '%Y-%m'), customer_code, contract_code
      UNION ALL
      SELECT project_code, DATE_FORMAT(received_at, '%Y-%m') AS period_month, customer_code, contract_code,
             0, 0, SUM(received_amount), 0, 0, 0
      FROM finance_receipt
      WHERE deleted_at IS NULL AND status <> 'canceled' AND project_code IS NOT NULL
      GROUP BY project_code, DATE_FORMAT(received_at, '%Y-%m'), customer_code, contract_code
      UNION ALL
      SELECT project_code, DATE_FORMAT(expense_date, '%Y-%m') AS period_month, customer_code, contract_code,
             0, 0, 0, SUM(expense_amount), 0, 0
      FROM finance_expense
      WHERE deleted_at IS NULL AND status <> 'canceled' AND project_code IS NOT NULL
      GROUP BY project_code, DATE_FORMAT(expense_date, '%Y-%m'), customer_code, contract_code
      UNION ALL
      SELECT project_code, period_month, NULL, NULL,
             0, 0, 0, 0,
             SUM(CASE WHEN allocation_type = 'labor' THEN amount ELSE 0 END),
             SUM(CASE WHEN allocation_type <> 'labor' THEN amount ELSE 0 END)
      FROM project_cost_allocation
      WHERE COALESCE(status, 'active') = 'active'
        AND project_code IS NOT NULL AND project_code <> ''
        AND period_month IS NOT NULL AND period_month <> ''
      GROUP BY project_code, period_month
      UNION ALL
      SELECT project_code, period_month, customer_code, contract_code,
             SUM(COALESCE(contract_amount, 0)), 0, 0, 0, 0, 0
      FROM project_finance_summary
      GROUP BY project_code, period_month, customer_code, contract_code
    ) metric
    WHERE ${where}
    GROUP BY metric.project_code, metric.period_month
  `
}

function performanceMetricSql(hasEmployeeFilter: boolean, hasPeriodFilter: boolean) {
  const where = [
    'status = \'active\'',
    hasEmployeeFilter ? 'employee_uid = ?' : '',
    hasPeriodFilter ? 'period_month = ?' : ''
  ].filter(Boolean).join(' AND ')

  return `
    SELECT
      employee_uid,
      MAX(employee_name) AS employee_name,
      MAX(dept_code) AS dept_code,
      period_month,
      SUM(COALESCE(contribution_amount, 0) * COALESCE(contribution_ratio, 1)) AS base_amount
    FROM employee_finance_contribution
    WHERE ${where}
    GROUP BY employee_uid, period_month
  `
}
