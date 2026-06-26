export type AltocPermissionAction
  = | 'view'
    | 'edit'
    | 'export'
    | 'assign'
    | 'disqualify'
    | 'convert'
    | 'activity'
    | 'transition'
    | 'approve'
    | 'confirm'
    | 'mark-billable'
    | 'finance-summary:sync'
    | 'delivery-asset-status:sync'
    | 'delivery-result:sync'
    | 'close'
    | 'admin'

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const serviceTicketCloseCommands = new Set(['close', 'closed'])
const readOnlyConfigPaths = new Set([
  'config/industries',
  'config/regions',
  'config/customer-levels',
  'config/customer-types',
  'config/opportunity-stages',
  'config/payment-term-templates',
  'config/contract-business-templates'
])

export function resolveAltocApiPermission(
  path: string,
  method: string,
  command = '',
  entityType = ''
): { resource: string, action: AltocPermissionAction } | null {
  const normalizedPath = normalizePath(path)
  const normalizedMethod = String(method || 'GET').toUpperCase()
  const normalizedCommand = String(command || '').trim().toLowerCase()
  const normalizedEntityType = String(entityType || '').trim()
  const action: AltocPermissionAction = mutatingMethods.has(normalizedMethod) ? 'edit' : 'view'

  if (!normalizedPath) return null
  if (normalizedPath.startsWith('attachments')) return null
  if (readOnlyConfigPaths.has(normalizedPath)) return null

  if (normalizedPath === 'config/dict') return { resource: 'settings', action }
  if (normalizedPath.startsWith('dashboard')) return { resource: 'dashboard', action: normalizedMethod === 'GET' ? 'view' : 'export' }
  if (normalizedPath.startsWith('audit-logs')) return { resource: 'admin', action: 'view' }
  if (normalizedPath.startsWith('teams')) return { resource: 'admin', action }

  const documentResource = documentPermissionResource(normalizedPath, normalizedEntityType)
  if (documentResource) return { resource: documentResource, action }

  if (/^service\/customers\/[^/]+\/maintenance-summary$/.test(normalizedPath)) {
    return { resource: 'customer', action: 'view' }
  }
  if (/^service\/contracts\/[^/]+\/finance-summary:sync$/.test(normalizedPath)) {
    return { resource: 'contract', action: 'finance-summary:sync' }
  }
  if (/^service\/contracts\/[^/]+\/invoice-request:(prepare|record)$/.test(normalizedPath)) {
    return { resource: 'contract', action: 'edit' }
  }
  if (/^service\/receivable-plans\/[^/]+\/mark-billable$/.test(normalizedPath)) {
    return { resource: 'receivable', action: 'mark-billable' }
  }
  if (/^service\/receivable-plans\/[^/]+\/invoice-request:(prepare|record)$/.test(normalizedPath)) {
    return { resource: 'receivable', action: 'edit' }
  }
  if (/^service\/payment-terms\/[^/]+\/receivable-plan:mark-billable$/.test(normalizedPath)) {
    return { resource: 'receivable', action: 'mark-billable' }
  }
  if (/^service\/customer-delivery-assets\/[^/]+\/status:sync$/.test(normalizedPath)) {
    return { resource: 'contract', action: 'delivery-asset-status:sync' }
  }
  if (/^service\/service-tickets\/[^/]+\/delivery-result:sync$/.test(normalizedPath)) {
    return { resource: 'service_ticket', action: 'delivery-result:sync' }
  }
  if (/^service\/service-agreements\/[^/]+\/(project-relations|default-project)(\/.*)?$/.test(normalizedPath)) {
    return { resource: 'contract', action }
  }
  if (/^service\/service-agreements\/[^/]+\/coverages(\/[^/]+:(resolve|suspend|end|confirm-legacy))?$/.test(normalizedPath)) {
    return { resource: 'contract', action }
  }
  if (/^service\/service-agreement-coverages\/by-(environment|delivery-asset)\/[^/]+$/.test(normalizedPath)) {
    return { resource: 'contract', action: 'view' }
  }
  if (/^service\/service-agreement-projects\/by-project\/[^/]+$/.test(normalizedPath)) {
    return { resource: 'contract', action: 'view' }
  }
  if (/^service\/projects\/[^/]+\/contract-lines$/.test(normalizedPath)) {
    return { resource: 'contract', action: 'view' }
  }
  if (normalizedPath.startsWith('service/')) return null

  if (/^leads\/[^/]+\/assign$/.test(normalizedPath)) return { resource: 'lead', action: 'assign' }
  if (/^leads\/[^/]+\/disqualify$/.test(normalizedPath)) return { resource: 'lead', action: 'disqualify' }
  if (/^leads\/[^/]+\/convert$/.test(normalizedPath)) return { resource: 'lead', action: 'convert' }
  if (/^leads\/[^/]+\/activities$/.test(normalizedPath)) return { resource: 'lead', action: 'activity' }
  if (normalizedPath.startsWith('leads')) return { resource: 'lead', action }

  if (/^opportunities\/[^/]+\/assign$/.test(normalizedPath)) return { resource: 'opportunity', action: 'assign' }
  if (/^opportunities\/[^/]+\/(transition|close-won|close-lost|pause|reopen)$/.test(normalizedPath)) {
    return { resource: 'opportunity', action: 'transition' }
  }
  if (/^opportunities\/[^/]+\/activities$/.test(normalizedPath)) return { resource: 'opportunity', action: 'activity' }
  if (/^opportunities\/[^/]+\/contact-roles(\/[^/]+)?$/.test(normalizedPath)) return { resource: 'opportunity', action }
  if (normalizedPath === 'opportunities/scan-stale') return { resource: 'opportunity', action: 'edit' }
  if (normalizedPath.startsWith('opportunities')) return { resource: 'opportunity', action }

  if (/^quotes\/[^/]+\/approve$/.test(normalizedPath)) return { resource: 'quotation', action: 'approve' }
  if (/^quotes\/[^/]+\/status$/.test(normalizedPath)) return { resource: 'quotation', action: 'edit' }
  if (/^quotes\/[^/]+\/items(\/[^/]+)?$/.test(normalizedPath)) return { resource: 'quotation', action }
  if (normalizedPath.startsWith('quotes')) return { resource: 'quotation', action }

  if (/^contracts\/[^/]+\/approve$/.test(normalizedPath)) return { resource: 'contract', action: 'approve' }
  if (/^contracts\/[^/]+\/(submit|withdraw|mark-signed|suspend|terminate)$/.test(normalizedPath)) return { resource: 'contract', action: 'edit' }
  if (/^contracts\/[^/]+\/fulfillment\/close$/.test(normalizedPath)) return { resource: 'contract', action: 'edit' }
  if (/^contract-obligations\/[^/]+\/(start|submit|accept|reject)$/.test(normalizedPath)) return { resource: 'contract', action: 'edit' }
  if (/^contracts\/[^/]+\/status$/.test(normalizedPath)) {
    return { resource: 'contract', action: normalizedCommand === 'approve' || normalizedCommand === 'reject' ? 'approve' : 'edit' }
  }
  if (/^contracts\/[^/]+\/management$/.test(normalizedPath)) return { resource: 'contract', action: 'admin' }
  if (/^contracts\/[^/]+\/invoice-request$/.test(normalizedPath)) return { resource: 'contract', action: 'edit' }
  if (/^contracts\/[^/]+\/(stages|invoices|obligations|billing-schedules|delivery-asset-plans|service-agreements)(\/[^/]+)?$/.test(normalizedPath)) return { resource: 'contract', action }
  if (normalizedPath === 'contracts/invoice-files/view') return { resource: 'contract', action: 'view' }
  if (normalizedPath.startsWith('contracts')) return { resource: 'contract', action }

  if (/^payments\/[^/]+\/confirm$/.test(normalizedPath)) return { resource: 'receivable', action: 'confirm' }
  if (normalizedPath === 'payments/scan-overdue') return { resource: 'receivable', action: 'edit' }
  if (normalizedPath.startsWith('payments')) return { resource: 'receivable', action }
  if (/^receivable-plans\/[^/]+\/invoice-request$/.test(normalizedPath)) return { resource: 'receivable', action: 'edit' }

  if (normalizedPath.startsWith('maintenance-contracts')) return { resource: 'maintenance_contract', action }
  if (normalizedPath.startsWith('service-entitlements')) return { resource: 'service_entitlement', action }
  if (normalizedPath.startsWith('service-tickets')) {
    return {
      resource: 'service_ticket',
      action: mutatingMethods.has(normalizedMethod) && serviceTicketCloseCommands.has(normalizedCommand) ? 'close' : action
    }
  }
  if (normalizedPath.startsWith('renewal-opportunities')) return { resource: 'renewal_opportunity', action }

  if (normalizedPath.startsWith('customers')) return { resource: 'customer', action }
  if (normalizedPath.startsWith('tenders')) return { resource: 'quotation', action }

  return null
}

function normalizePath(path: string) {
  return String(path || '')
    .replace(/^\/+/, '')
    .replace(/^api\/v1\/?/, '')
    .replace(/^v1\/altoc\/?/, '')
}

function documentPermissionResource(path: string, entityType: string) {
  if (!/^documents(\/[^/]+)?$/.test(path)) return ''
  if (entityType === 'customer') return 'customer'
  if (entityType === 'lead') return 'lead'
  if (entityType === 'opportunity') return 'opportunity'
  if (entityType === 'quotation' || entityType === 'tender') return 'quotation'
  if (entityType === 'contract') return 'contract'
  return ''
}
