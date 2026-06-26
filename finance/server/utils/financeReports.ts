import type { H3Event } from 'h3'
import type { RowDataPacket } from '~~/server/utils/db'
import { getStringQuery, missingSchemaWarning, type ApiDataResult, type ApiListResult } from './financeApi'
import { queryRows } from './db'

export type FinanceMonthlyReportRow = RowDataPacket & {
  period_month: string
  invoice_amount: string
  receipt_amount: string
  expense_amount: string
  unreconciled_amount: string
  project_gross_profit_amount: string
  performance_amount: string
  net_cash_amount: string
}

export type ProjectFinanceDetail = {
  projectCode: string
  periods: RowDataPacket[]
  totals: {
    contractAmount: string
    invoiceAmount: string
    receivedAmount: string
    directExpenseAmount: string
    laborCostAmount: string
    allocatedCostAmount: string
    grossProfitAmount: string
  }
  allocations: RowDataPacket[]
  employeeCosts: RowDataPacket[]
  contributions: RowDataPacket[]
}

export async function monthlyFinanceReport(event: H3Event): Promise<ApiListResult<FinanceMonthlyReportRow>> {
  const year = normalizeYear(getStringQuery(event, 'year'))
  const periodMonth = getStringQuery(event, 'period_month')

  try {
    const rows = await queryRows<FinanceMonthlyReportRow[]>(monthlyReportSql(Boolean(periodMonth)), periodMonth ? [periodMonth] : [year])
    return {
      data: rows,
      total: rows.length,
      page: 1,
      pageSize: rows.length || 20
    }
  } catch (error) {
    const warning = missingSchemaWarning(error)
    if (!warning) throw error
    return {
      data: [],
      total: 0,
      page: 1,
      pageSize: 20,
      warning
    }
  }
}

export async function projectFinanceDetail(projectCode: string): Promise<ApiDataResult<ProjectFinanceDetail>> {
  try {
    const [periods, allocations, employeeCosts, contributions] = await Promise.all([
      queryRows<RowDataPacket[]>(
        `SELECT *
         FROM project_finance_summary
         WHERE project_code = ?
         ORDER BY period_month DESC`,
        [projectCode]
      ),
      queryRows<RowDataPacket[]>(
        `SELECT *
         FROM project_cost_allocation
         WHERE project_code = ? AND status = 'active'
         ORDER BY period_month DESC, id DESC
         LIMIT 100`,
        [projectCode]
      ),
      queryRows<RowDataPacket[]>(
        `SELECT cost.*
         FROM employee_cost_snapshot cost
         INNER JOIN project_cost_allocation allocation
           ON allocation.employee_uid = cost.employee_uid
          AND allocation.period_month = cost.period_month
          AND allocation.status = 'active'
         WHERE allocation.project_code = ?
         ORDER BY cost.period_month DESC, cost.employee_uid ASC
         LIMIT 100`,
        [projectCode]
      ),
      queryRows<RowDataPacket[]>(
        `SELECT *
         FROM employee_finance_contribution
         WHERE project_code = ? AND status = 'active'
         ORDER BY period_month DESC, employee_uid ASC
         LIMIT 100`,
        [projectCode]
      )
    ])

    return {
      data: {
        projectCode,
        periods,
        totals: sumProjectPeriods(periods),
        allocations,
        employeeCosts,
        contributions
      }
    }
  } catch (error) {
    const warning = missingSchemaWarning(error)
    if (!warning) throw error
    return {
      warning,
      data: {
        projectCode,
        periods: [],
        totals: {
          contractAmount: '0.00',
          invoiceAmount: '0.00',
          receivedAmount: '0.00',
          directExpenseAmount: '0.00',
          laborCostAmount: '0.00',
          allocatedCostAmount: '0.00',
          grossProfitAmount: '0.00'
        },
        allocations: [],
        employeeCosts: [],
        contributions: []
      }
    }
  }
}

function sumProjectPeriods(rows: RowDataPacket[]) {
  return {
    contractAmount: sumAmount(rows, 'contract_amount'),
    invoiceAmount: sumAmount(rows, 'invoice_amount'),
    receivedAmount: sumAmount(rows, 'received_amount'),
    directExpenseAmount: sumAmount(rows, 'direct_expense_amount'),
    laborCostAmount: sumAmount(rows, 'labor_cost_amount'),
    allocatedCostAmount: sumAmount(rows, 'allocated_cost_amount'),
    grossProfitAmount: sumAmount(rows, 'gross_profit_amount')
  }
}

function sumAmount(rows: RowDataPacket[], key: string) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0).toFixed(2)
}

function normalizeYear(value: string) {
  const year = value || new Date().toISOString().slice(0, 4)
  return /^\d{4}$/.test(year) ? year : new Date().toISOString().slice(0, 4)
}

function monthlyReportSql(hasPeriodFilter: boolean) {
  const filter = hasPeriodFilter ? 'monthly.period_month = ?' : 'monthly.period_month LIKE CONCAT(?, \'-%\')'

  return `
    SELECT
      monthly.period_month,
      SUM(monthly.invoice_amount) AS invoice_amount,
      SUM(monthly.receipt_amount) AS receipt_amount,
      SUM(monthly.expense_amount) AS expense_amount,
      SUM(monthly.unreconciled_amount) AS unreconciled_amount,
      SUM(monthly.project_gross_profit_amount) AS project_gross_profit_amount,
      SUM(monthly.performance_amount) AS performance_amount,
      SUM(monthly.receipt_amount) - SUM(monthly.expense_amount) AS net_cash_amount
    FROM (
      SELECT DATE_FORMAT(invoice_date, '%Y-%m') AS period_month,
             SUM(invoice_amount) AS invoice_amount,
             0 AS receipt_amount,
             0 AS expense_amount,
             0 AS unreconciled_amount,
             0 AS project_gross_profit_amount,
             0 AS performance_amount
      FROM finance_invoice
      WHERE deleted_at IS NULL AND status <> 'canceled'
      GROUP BY DATE_FORMAT(invoice_date, '%Y-%m')
      UNION ALL
      SELECT DATE_FORMAT(received_at, '%Y-%m') AS period_month,
             0,
             SUM(received_amount),
             0,
             SUM(COALESCE(unreconciled_amount, 0)),
             0,
             0
      FROM finance_receipt
      WHERE deleted_at IS NULL AND status <> 'canceled'
      GROUP BY DATE_FORMAT(received_at, '%Y-%m')
      UNION ALL
      SELECT DATE_FORMAT(expense_date, '%Y-%m') AS period_month,
             0,
             0,
             SUM(expense_amount),
             0,
             0,
             0
      FROM finance_expense
      WHERE deleted_at IS NULL AND status <> 'canceled'
      GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
      UNION ALL
      SELECT period_month,
             0,
             0,
             0,
             0,
             SUM(gross_profit_amount),
             0
      FROM project_finance_summary
      GROUP BY period_month
      UNION ALL
      SELECT period_month,
             0,
             0,
             0,
             0,
             0,
             SUM(performance_amount)
      FROM employee_finance_performance
      WHERE status <> 'canceled'
      GROUP BY period_month
    ) monthly
    WHERE ${filter}
    GROUP BY monthly.period_month
    ORDER BY monthly.period_month DESC
  `
}
