import type { RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler } from 'h3'
import { missingSchemaWarning, type ApiDataResult } from '../../../../utils/financeApi'
import { queryRow } from '../../../../utils/db'
import {
  assertFinanceRuntimeGlobalProjectAccountingAccess,
  buildFinanceRuntimeAuthQuery,
  maybeCallCurrentFinanceDataRuntime
} from '../../../../utils/dataRuntime'
import type { FinanceDashboardSummary } from '../../../../types/finance'

export default defineEventHandler(async (event): Promise<ApiDataResult<FinanceDashboardSummary>> => {
  const runtime = await maybeCallCurrentFinanceDataRuntime<ApiDataResult<FinanceDashboardSummary>>(event)
  if (runtime.handled) return runtime.data
  const authQuery = await buildFinanceRuntimeAuthQuery(event, '/v1/finance/dashboard/summary', 'GET')
  assertFinanceRuntimeGlobalProjectAccountingAccess(authQuery, 'Dashboard summary fallback requires global project finance access.')

  try {
    const row = await queryRow<RowDataPacket & FinanceDashboardSummary>(`
      SELECT
        COALESCE((SELECT SUM(invoice_amount) FROM finance_invoice WHERE deleted_at IS NULL AND status <> 'canceled' AND DATE_FORMAT(COALESCE(invoice_date, created_at), '%Y-%m') = DATE_FORMAT(CURRENT_DATE(), '%Y-%m')), 0) AS monthInvoiceAmount,
        COALESCE((SELECT SUM(received_amount) FROM finance_receipt WHERE deleted_at IS NULL AND status <> 'canceled' AND DATE_FORMAT(received_at, '%Y-%m') = DATE_FORMAT(CURRENT_DATE(), '%Y-%m')), 0) AS monthReceiptAmount,
        COALESCE((SELECT COUNT(*) FROM expense_claim WHERE deleted_at IS NULL AND status = 'pending_approval'), 0)
          + COALESCE((SELECT COUNT(*) FROM project_expense_request WHERE deleted_at IS NULL AND status = 'pending_approval'), 0)
          + COALESCE((SELECT COUNT(*) FROM payment_request WHERE deleted_at IS NULL AND status = 'pending_approval'), 0) AS pendingExpenseCount,
        COALESCE((SELECT SUM(gross_profit_amount) FROM project_finance_summary WHERE period_month = DATE_FORMAT(CURRENT_DATE(), '%Y-%m')), 0) AS projectGrossProfitAmount,
        COALESCE((SELECT SUM(COALESCE(unreconciled_amount, received_amount - reconciled_amount)) FROM finance_receipt WHERE deleted_at IS NULL AND status IN ('confirmed', 'partially_reconciled')), 0) AS unreconciledReceiptAmount,
        COALESCE((SELECT COUNT(*) FROM finance_bank_account WHERE deleted_at IS NULL AND status = 'active'), 0) AS bankAccountCount
    `)

    return {
      data: {
        monthInvoiceAmount: String(row?.monthInvoiceAmount || '0.00'),
        monthReceiptAmount: String(row?.monthReceiptAmount || '0.00'),
        pendingExpenseCount: Number(row?.pendingExpenseCount || 0),
        projectGrossProfitAmount: String(row?.projectGrossProfitAmount || '0.00'),
        unreconciledReceiptAmount: String(row?.unreconciledReceiptAmount || '0.00'),
        bankAccountCount: Number(row?.bankAccountCount || 0)
      }
    }
  } catch (error) {
    const warning = missingSchemaWarning(error)
    if (!warning) throw error
    return {
      warning,
      data: {
        monthInvoiceAmount: '0.00',
        monthReceiptAmount: '0.00',
        pendingExpenseCount: 0,
        projectGrossProfitAmount: '0.00',
        unreconciledReceiptAmount: '0.00',
        bankAccountCount: 0
      }
    }
  }
})
