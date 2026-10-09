export type FinancePermissionAction = 'view' | 'edit' | 'approve' | 'issue' | 'confirm' | 'export' | 'admin'

export interface FinancePermissionRouteRule {
  resource: string
  action: FinancePermissionAction
}

interface ResolveFinancePermissionInput {
  status?: unknown
}

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function normalizedStatus(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function sensitiveStatusAction(value: unknown): FinancePermissionAction | null {
  const status = normalizedStatus(value)
  if (status === 'approved' || status === 'issued') return 'approve'
  if (status === 'paid' || status === 'confirmed' || status === 'reconciled') return 'confirm'
  return null
}

export function financeRouteNeedsBodyStatus(path: string, method: string) {
  const normalizedMethod = String(method || 'GET').toUpperCase()
  if (!['POST', 'PUT', 'PATCH'].includes(normalizedMethod)) return false
  return path.startsWith('invoice-requests')
    || path.startsWith('expenses')
    || path.startsWith('payment-requests')
    || path.startsWith('expense-claims')
    || path.startsWith('project-expense-requests')
}

export function resolveFinanceApiPermission(
  path: string,
  method: string,
  input: ResolveFinancePermissionInput = {}
): FinancePermissionRouteRule | null {
  const normalizedMethod = String(method || 'GET').toUpperCase()
  const first = path.split('/')[0] || ''
  const action: FinancePermissionAction = mutatingMethods.has(normalizedMethod) ? 'edit' : 'view'
  const statusAction = sensitiveStatusAction(input.status)

  if (path.startsWith('dashboard/')) return { resource: 'dashboard', action: 'view' }
  if (path === 'authorization/instance-conflict-explain') return { resource: 'expenses', action: 'view' }
  if (path.startsWith('settings/') || path.startsWith('accounting-objects') || path.startsWith('audit-logs')) return { resource: 'settings', action: 'admin' }
  if (path.startsWith('integrations/') || path.startsWith('workflow/actions/')) return { resource: 'settings', action: 'admin' }
  if (path.startsWith('migrations/')) return { resource: 'settings', action: 'admin' }
  if (path.startsWith('contracts/')) return { resource: 'invoices', action: 'view' }
  if (/^invoices\/[^/]+\/delete-with-file$/.test(path)) return { resource: 'invoices', action: 'admin' }
  if (/^invoices\/[^/]+\/receipt-reconcile$/.test(path)) return { resource: 'reconciliation', action: 'confirm' }
  if (/^invoice-requests\/[^/]+\/submit$/.test(path)) return { resource: 'invoices', action: 'edit' }
  if (/^invoice-requests\/[^/]+\/issue$/.test(path)) return { resource: 'invoices', action: 'issue' }
  if (/^invoice-requests\/[^/]+\/assign-issuance$/.test(path)) return { resource: 'invoices', action: 'issue' }
  if (path.startsWith('invoice-requests')) {
    if (statusAction === 'approve') return { resource: 'invoices', action: 'approve' }
    return { resource: 'invoices', action }
  }
  if (path.startsWith('invoices')) return { resource: 'invoices', action }
  if (/^receipts\/[^/]+\/classify$/.test(path)) return { resource: 'receipts', action: 'edit' }
  if (path.startsWith('receipts')) {
    if (normalizedMethod === 'GET') return { resource: 'receipts', action: 'view' }
    if (normalizedMethod === 'POST' || normalizedMethod === 'PATCH') return { resource: 'receipts', action: 'confirm' }
    return { resource: 'receipts', action: 'edit' }
  }
  if (path.startsWith('reconciliation')) {
    return { resource: 'reconciliation', action: normalizedMethod === 'GET' ? 'view' : 'confirm' }
  }
  if (path === 'expenses' && normalizedMethod === 'POST' && !normalizedStatus(input.status)) {
    return { resource: 'expenses', action: 'confirm' }
  }
  if (path.startsWith('expenses')) {
    if (statusAction === 'confirm') return { resource: 'expenses', action: 'confirm' }
    return { resource: 'expenses', action }
  }
  if (path.startsWith('payment-requests') || path.startsWith('expense-claims') || path.startsWith('project-expense-requests')) {
    if (statusAction === 'approve') return { resource: 'expenses', action: 'approve' }
    if (statusAction === 'confirm') return { resource: 'expenses', action: 'confirm' }
    return { resource: 'expenses', action }
  }
  if (path.startsWith('bank-accounts')) return resolveBankAccountPermission(path, normalizedMethod, action)
  if (path.startsWith('project-accounting') || path.startsWith('project-cost-allocations') || path.startsWith('employee-costs')) {
    return { resource: 'project_accounting', action }
  }
  if (path.startsWith('performance') || path.startsWith('performance-rules') || path.startsWith('employee-contributions')) {
    return { resource: 'performance', action }
  }
  if (path === 'reports/export') return { resource: 'reports', action: 'export' }
  if (path.startsWith('reports')) return { resource: 'reports', action: normalizedMethod === 'GET' ? 'view' : 'admin' }
  if (!first) return null
  return { resource: first.replace(/-/g, '_'), action }
}

function resolveBankAccountPermission(path: string, method: string, fallbackAction: FinancePermissionAction) {
  if (method === 'GET') return { resource: 'bank_accounts', action: 'view' as const }
  if (/^bank-accounts\/[^/]+\/balance-snapshots$/.test(path)) {
    return { resource: 'bank_accounts', action: 'edit' as const }
  }
  if (path === 'bank-accounts/balances') {
    return { resource: 'bank_accounts', action: 'edit' as const }
  }
  if (path === 'bank-accounts' || /^bank-accounts\/[^/]+$/.test(path)) {
    return { resource: 'bank_accounts', action: 'admin' as const }
  }
  return { resource: 'bank_accounts', action: fallbackAction }
}
