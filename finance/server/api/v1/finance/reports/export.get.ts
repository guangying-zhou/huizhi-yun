import { createError, defineEventHandler, setHeader, type H3Event } from 'h3'
import {
  buildFinanceRuntimeAuthQuery,
  maybeCallFinanceDataRuntime
} from '../../../../utils/dataRuntime'
import type { ApiListResult } from '../../../../utils/financeApi'

interface FinanceMonthlyReportRow {
  period_month?: unknown
  invoice_amount?: unknown
  receipt_amount?: unknown
  expense_amount?: unknown
  unreconciled_amount?: unknown
  project_gross_profit_amount?: unknown
  performance_amount?: unknown
  net_cash_amount?: unknown
}

const exportColumns: Array<{ key: keyof FinanceMonthlyReportRow, label: string }> = [
  { key: 'period_month', label: 'period_month' },
  { key: 'invoice_amount', label: 'invoice_amount' },
  { key: 'receipt_amount', label: 'receipt_amount' },
  { key: 'expense_amount', label: 'expense_amount' },
  { key: 'unreconciled_amount', label: 'unreconciled_amount' },
  { key: 'project_gross_profit_amount', label: 'project_gross_profit_amount' },
  { key: 'performance_amount', label: 'performance_amount' },
  { key: 'net_cash_amount', label: 'net_cash_amount' }
]

export default defineEventHandler(async (event) => {
  const report = await resolveMonthlyReportForExport(event)
  const year = String(event.node.req.url || '').match(/[?&]year=(\d{4})(?:&|$)/)?.[1] || new Date().toISOString().slice(0, 4)
  const csv = monthlyReportCsv(report.data || [])

  setHeader(event, 'content-type', 'text/csv; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="finance-monthly-report-${year}.csv"`)
  setHeader(event, 'cache-control', 'no-store')
  return csv
})

async function resolveMonthlyReportForExport(event: H3Event): Promise<ApiListResult<FinanceMonthlyReportRow>> {
  const authQuery = await buildFinanceRuntimeAuthQuery(event, '/v1/finance/reports', 'GET')
  const runtime = await maybeCallFinanceDataRuntime<ApiListResult<FinanceMonthlyReportRow>>(
    event,
    '/v1/finance/reports',
    { scope: 'finance.reports.read', method: 'GET', query: authQuery }
  )
  if (runtime.handled) return runtime.data

  throw createError({
    statusCode: 503,
    message: 'Finance tenant-runtime is required for Finance report exports.'
  })
}

function monthlyReportCsv(rows: FinanceMonthlyReportRow[]) {
  const header = exportColumns.map(column => csvCell(column.label)).join(',')
  const body = rows.map(row => exportColumns.map(column => csvCell(row[column.key])).join(','))
  return [header, ...body].join('\n') + '\n'
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  if (!/[",\n\r]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}
