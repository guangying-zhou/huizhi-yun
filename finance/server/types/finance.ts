import type { RowDataPacket } from '~~/server/utils/db'

export interface FinanceSummaryMetric {
  label: string
  value: string
  hint: string
}

export interface FinanceDashboardSummary {
  monthInvoiceAmount: string
  monthReceiptAmount: string
  pendingExpenseCount: number
  projectGrossProfitAmount: string
  unreconciledReceiptAmount: string
  bankAccountCount: number
}

export type FinanceRow = RowDataPacket & Record<string, string | number | null>
