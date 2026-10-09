export interface FinanceSummaryMetric {
  label: string
  value: string
  hint: string
}

export interface FinanceDashboardSummary {
  monthInvoiceAmount: string
  monthReceiptAmount: string
  pendingExpenseCount: number
  projectGrossProfitAmount: string | null
  projectCostNotReadyCount: number
  unreconciledReceiptAmount: string
  bankAccountCount: number
}

export type FinanceRow = Record<string, string | number | null>
