export interface FinanceBillingCandidate { code: string, currency_code: string, amount: string, received_amount: string, row_version: number }
export type FinanceLedgerKind = 'invoice-requests' | 'invoices' | 'receipts' | 'reconciliation' | 'expenses' | 'claims' | 'project-requests' | 'payment-requests'
export interface FinanceLedgerRow {
  id: number
  code: string
  row_version: number
  status: string
  currency_code: string
  contract_code?: string
  billing_schedule_code?: string
  customer_name?: string
  requested_by?: string
  confirmed_by?: string
  requested_amount?: string
  invoice_amount?: string
  received_amount?: string
  reconciled_amount?: string
  unreconciled_amount?: string
  attachments?: Array<{ code: string, file_key: string, file_name: string }>
  [key: string]: unknown
}
export interface FinanceLedgerPage { data: FinanceLedgerRow[], total: number, page: number, pageSize: number }
export const ledgerTitles: Record<FinanceLedgerKind, string> = { 'expenses': '支出台账', 'claims': '费用报销', 'project-requests': '项目支出申请', 'payment-requests': '付款申请', 'invoice-requests': '开票申请', 'invoices': '正式发票', 'receipts': '到账', 'reconciliation': '核销' }
export const ledgerResource: Record<FinanceLedgerKind, string> = { 'expenses': 'expenses', 'claims': 'expenses', 'project-requests': 'expenses', 'payment-requests': 'expenses', 'invoice-requests': 'invoices', 'invoices': 'invoices', 'receipts': 'receipts', 'reconciliation': 'reconciliation' }
export const ledgerPath = (kind: FinanceLedgerKind) => ({ 'invoice-requests': '/invoices/requests', 'claims': '/expenses/claims', 'project-requests': '/expenses/project-requests', 'payment-requests': '/payment-requests' })[kind as 'invoice-requests' | 'claims' | 'project-requests' | 'payment-requests'] || `/${kind}`
export const ledgerApi = (kind: FinanceLedgerKind) => ({ 'claims': 'expense-claims', 'project-requests': 'project-expense-requests', 'payment-requests': 'payment-requests' })[kind as 'claims' | 'project-requests' | 'payment-requests'] || kind
export const isSpend = (kind: FinanceLedgerKind) => ['expenses', 'claims', 'project-requests', 'payment-requests'].includes(kind)
export const ledgerStatusLabel = (status: string, kind?: FinanceLedgerKind) => status === 'canceled' && kind && kind !== 'invoices' ? '已取消' : ({ paid: '已付款', draft: '草稿', pending_approval: '待审批', approved: '已批准', rejected: '已退回', issued: '已开票', canceled: '已作废', confirmed: '已确认', partially_reconciled: '部分核销', reconciled: '已核销', active: '有效', reversed: '已撤销', red_reversed: '已红冲' })[status] || '未知状态'
export function ledgerAmount(row: FinanceLedgerRow) {
  return row.expense_amount as string || row.total_amount as string || row.requested_amount || row.invoice_amount || row.received_amount || row.reconciled_amount || '0.00'
}
export function ledgerWriteMessage(error: unknown) {
  const e = error as { statusCode?: number, status?: number, response?: { status?: number }, data?: { code?: string, requestFrozen?: boolean, data?: { code?: string, requestFrozen?: boolean } } }
  const code = e.data?.data?.code || e.data?.code
  const status = e.statusCode || e.status || e.response?.status
  if (e.data?.requestFrozen || e.data?.data?.requestFrozen) return '审批提交结果未确认，申请已冻结；请沿用同一请求重试，系统也会自动恢复'
  if (code === 'finance_approval_scope_denied') return '仅申请人且具备开票申请编辑权限时可提交审批'
  if (code === 'finance_payment_confirmation_duty_separation_required') return '付款确认人不能是制单人或经办人，请由另一位获权人员办理'
  if (code === 'finance_applicant_required') return '仅申请人可编辑或取消此申请'
  if (code === 'finance_invoice_issuance_responsible_required') return '仅当前开票责任人可办理，请刷新确认责任关系；草稿已保留'
  if (code === 'finance_invoice_attachment_issue_required') return '待开票申请附件需要开票权限，请由当前开票责任人办理'
  if (code === 'finance_invoice_issue_duty_separation_required') return '开票申请人不能是开票人，请由另一位获权人员办理'
  if (code === 'finance_reconciliation_duty_separation_required') return '到账确认人不能是核销人，请由另一位获权人员办理'
  if (code === 'finance_receipt_not_confirmed') return '到账尚未确认，请先确认到账后再核销'
  if (code === 'finance_amount_exceeded') return '金额超过可开票或可核销余额，请刷新比较'
  if (status === 409) return '内容已被他人修改或业务状态已变更，请刷新比较；草稿已保留'
  if (status === 403) return '您没有权限或当前责任关系已变更；草稿已保留'
  if (status === 400) return '请检查金额、日期、附件及关联对象后重试'
  if (status && status >= 500) return '服务暂时不可用，请稍后重试；草稿已保留'
  return '保存结果未确认，可能已提交，重试将沿用同一请求安全续行'
}
