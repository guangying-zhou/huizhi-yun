export type AssetsPermissionAction = 'view' | 'edit' | 'approve' | 'admin'

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const purchaseOrderApprovalStatuses = new Set(['approved', 'rejected', 'closed'])
const assignmentApprovalStatuses = new Set(['active', 'returned', 'released', 'completed', 'cancelled', 'canceled'])
const assetApprovalStatuses = new Set(['approved'])

export function resolveAssetsApiPermission(
  path: string,
  method: string,
  status = ''
): { resource: string, action: AssetsPermissionAction } | null {
  const normalizedPath = String(path || '').replace(/^\/+/, '')
  const normalizedMethod = String(method || 'GET').toUpperCase()
  const normalizedStatus = String(status || '').trim().toLowerCase()
  const action: AssetsPermissionAction = mutatingMethods.has(normalizedMethod) ? 'edit' : 'view'

  if (!normalizedPath || normalizedPath.startsWith('service/')) return null
  if (normalizedPath.startsWith('dashboard/')) return { resource: 'dashboard', action: 'view' }
  if (normalizedPath.startsWith('admin/') || normalizedPath.startsWith('dictionaries') || normalizedPath.startsWith('asset-categories')) {
    return { resource: 'admin', action: 'admin' }
  }
  if (/^assets\/[^/]+\/status$/.test(normalizedPath) && normalizedMethod === 'POST') {
    return { resource: 'asset_items', action: assetApprovalStatuses.has(normalizedStatus) ? 'approve' : 'edit' }
  }
  if (normalizedPath.startsWith('assets')) return { resource: 'asset_items', action }
  if (normalizedPath.startsWith('products')) return { resource: 'products', action }
  if (normalizedPath.startsWith('ip-assets')) return { resource: 'ip_assets', action }
  if (normalizedPath.startsWith('digital-assets')) return { resource: 'digital_assets', action }
  if (normalizedPath.startsWith('technology-bases')) return { resource: 'technology_bases', action }
  if (normalizedPath.startsWith('environments')) return { resource: 'environments', action }
  if (normalizedPath.startsWith('deliveries')) return { resource: 'deliveries', action }
  if (normalizedPath.startsWith('suppliers')) return { resource: 'suppliers', action }
  if (/^purchase-orders\/[^/]+\/workflow:sync$/.test(normalizedPath) && normalizedMethod === 'POST') {
    return { resource: 'purchase_orders', action: 'approve' }
  }
  if (normalizedPath.startsWith('purchase-orders')) {
    if (mutatingMethods.has(normalizedMethod) && purchaseOrderApprovalStatuses.has(normalizedStatus)) {
      return { resource: 'purchase_orders', action: 'approve' }
    }
    return { resource: 'purchase_orders', action }
  }
  if (normalizedPath.startsWith('receipts')) return { resource: 'receipts', action }
  if (/^assignments\/[^/]+\/workflow:sync$/.test(normalizedPath) && normalizedMethod === 'POST') {
    return { resource: 'assignments', action: 'approve' }
  }
  if (normalizedPath.startsWith('assignments')) {
    if (mutatingMethods.has(normalizedMethod) && assignmentApprovalStatuses.has(normalizedStatus)) {
      return { resource: 'assignments', action: 'approve' }
    }
    return { resource: 'assignments', action }
  }
  if (normalizedPath.startsWith('alerts')) return { resource: 'alerts', action }
  if (normalizedPath.startsWith('reports')) return { resource: 'reports', action: normalizedMethod === 'GET' ? 'view' : 'admin' }
  return null
}
