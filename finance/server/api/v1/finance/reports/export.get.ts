import { defineEventHandler, setHeader } from 'h3'
import { monthlyFinanceReport, type FinanceMonthlyReportRow } from '../../../../utils/financeReports'
import {
  assertFinanceRuntimeGlobalProjectAccountingAccess,
  buildFinanceRuntimeAuthQuery,
  maybeCallFinanceDataRuntime
} from '../../../../utils/dataRuntime'
import type { ApiListResult } from '../../../../utils/financeApi'

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

async function resolveMonthlyReportForExport(event: Parameters<typeof monthlyFinanceReport>[0]): Promise<ApiListResult<FinanceMonthlyReportRow>> {
  const authQuery = await buildFinanceRuntimeAuthQuery(event, '/v1/finance/reports', 'GET')
  const runtime = await maybeCallFinanceDataRuntime<ApiListResult<FinanceMonthlyReportRow>>(
    event,
    '/v1/finance/reports',
    { scope: 'finance.reports.read', method: 'GET', query: authQuery }
  )
  if (runtime.handled) return runtime.data

  assertFinanceRuntimeGlobalProjectAccountingAccess(authQuery)
  return monthlyFinanceReport(event)
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
