import { getRequestURL, readBody, type H3Event } from 'h3'
import { requirePermission } from '../utils/checkPermission'

type PermissionAction = 'view' | 'edit' | 'approve' | 'confirm' | 'export' | 'admin'

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  const pathname = normalizeApiPath(url.pathname)
  if (!pathname.startsWith('/api/v1/finance/')) return

  const path = pathname.replace(/^\/api\/v1\/finance\/?/, '')
  if (path === 'workflow/callback') return

  const method = String(event.node.req.method || 'GET').toUpperCase()
  const rule = await resolveApiPermission(event, path, method)
  if (!rule) return

  await requirePermission(event, rule.resource, rule.action)
})

function normalizeApiPath(pathname: string) {
  const config = useRuntimeConfig() as unknown as { public?: { appBasePath?: string } }
  const basePath = String(config.public?.appBasePath || '').replace(/\/+$/, '')
  if (basePath && basePath !== '/' && pathname.startsWith(`${basePath}/api/`)) {
    return pathname.slice(basePath.length)
  }
  return pathname
}

async function resolveApiPermission(event: H3Event, path: string, method: string): Promise<{ resource: string, action: PermissionAction } | null> {
  const first = path.split('/')[0] || ''
  const action: PermissionAction = mutatingMethods.has(method) ? 'edit' : 'view'

  if (path.startsWith('dashboard/')) return { resource: 'dashboard', action: 'view' }
  if (path.startsWith('settings/') || path.startsWith('accounting-objects') || path.startsWith('audit-logs')) return { resource: 'settings', action: 'admin' }
  if (path.startsWith('integrations/') || path.startsWith('workflow/actions/')) return { resource: 'settings', action: 'admin' }
  if (path.startsWith('migrations/')) return { resource: 'settings', action: 'admin' }
  if (path.startsWith('contracts/')) return { resource: 'invoices', action: 'view' }
  if (/^invoices\/[^/]+\/delete-with-file$/.test(path)) return { resource: 'invoices', action: 'admin' }
  if (/^invoice-requests\/[^/]+\/submit$/.test(path)) return { resource: 'invoices', action: 'edit' }
  if (path.startsWith('invoice-requests') || path.startsWith('invoices')) return { resource: 'invoices', action }
  if (/^receipts\/[^/]+\/classify$/.test(path)) return { resource: 'receipts', action: 'edit' }
  if (path.startsWith('receipts')) {
    if (method === 'GET') return { resource: 'receipts', action: 'view' }
    if (method === 'POST' || method === 'PATCH') return { resource: 'receipts', action: 'confirm' }
    return { resource: 'receipts', action: 'edit' }
  }
  if (path.startsWith('reconciliation')) {
    return { resource: 'reconciliation', action: method === 'GET' ? 'view' : 'confirm' }
  }
  if (path.startsWith('expenses') || path.startsWith('payment-requests')) {
    if (await isExplicitPaymentConfirmationMutation(event, method)) {
      return { resource: 'expenses', action: 'confirm' }
    }
    return { resource: 'expenses', action }
  }
  if (path.startsWith('expense-claims') || path.startsWith('project-expense-requests')) {
    return { resource: 'expenses', action }
  }
  if (path.startsWith('bank-accounts')) return resolveBankAccountPermission(path, method, action)
  if (path.startsWith('project-accounting') || path.startsWith('project-cost-allocations') || path.startsWith('employee-costs')) {
    return { resource: 'project_accounting', action }
  }
  if (path.startsWith('performance') || path.startsWith('performance-rules') || path.startsWith('employee-contributions')) {
    return { resource: 'performance', action }
  }
  if (path === 'reports/export') return { resource: 'reports', action: 'export' }
  if (path.startsWith('reports')) return { resource: 'reports', action: method === 'GET' ? 'view' : 'admin' }
  if (!first) return null
  return { resource: first.replace(/-/g, '_'), action }
}

async function isExplicitPaymentConfirmationMutation(event: H3Event, method: string) {
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return false
  const body = await readBody<Record<string, unknown>>(event).catch((): Record<string, unknown> => ({}))
  const status = String(body?.status || '').trim().toLowerCase()
  return status === 'paid' || status === 'confirmed'
}

function resolveBankAccountPermission(path: string, method: string, fallbackAction: PermissionAction) {
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
