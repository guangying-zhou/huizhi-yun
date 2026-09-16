export type ApprovalBizType = 'invoice_request' | 'expense_claim' | 'project_expense_request' | 'payment_request'

export interface ApprovalTargetConfig {
  bizType: ApprovalBizType
  table: string
  codePrefix: string
  notFoundMessage: string
}

export const approvalTargets: Record<ApprovalBizType, ApprovalTargetConfig> = {
  invoice_request: {
    bizType: 'invoice_request',
    table: 'invoice_request',
    codePrefix: 'IR',
    notFoundMessage: 'invoice request not found'
  },
  expense_claim: {
    bizType: 'expense_claim',
    table: 'expense_claim',
    codePrefix: 'CLM',
    notFoundMessage: 'expense claim not found'
  },
  project_expense_request: {
    bizType: 'project_expense_request',
    table: 'project_expense_request',
    codePrefix: 'PER',
    notFoundMessage: 'project expense request not found'
  },
  payment_request: {
    bizType: 'payment_request',
    table: 'payment_request',
    codePrefix: 'PAY',
    notFoundMessage: 'payment request not found'
  }
}
