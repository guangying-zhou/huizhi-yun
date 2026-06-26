export interface BaselinePermission {
  appCode: string
  resourceCode: string
  action: string
  scopeType: string
  scopeValue: string
}

// Baseline permissions are employee self-service defaults. Console and Assets
// access must come from explicit tenant roles/templates.
export const BASELINE_PERMISSIONS: BaselinePermission[] = [
  { appCode: 'workflow', resourceCode: 'workflow_workspace', action: 'view', scopeType: 'subject', scopeValue: 'self' },
  { appCode: 'workflow', resourceCode: 'workflow_tasks', action: 'view', scopeType: 'relation', scopeValue: 'assigned' },
  { appCode: 'workflow', resourceCode: 'workflow_tasks', action: 'edit', scopeType: 'relation', scopeValue: 'assigned' },
  { appCode: 'workflow', resourceCode: 'workflow_instances', action: 'view', scopeType: 'subject', scopeValue: 'self' },
  { appCode: 'codocs', resourceCode: 'documents', action: 'view', scopeType: 'relation', scopeValue: 'owned_or_shared' },
  { appCode: 'codocs', resourceCode: 'documents', action: 'create', scopeType: 'subject', scopeValue: 'self' },
  { appCode: 'codocs', resourceCode: 'documents', action: 'edit', scopeType: 'relation', scopeValue: 'owned_or_shared' },
  { appCode: 'codocs', resourceCode: 'documents', action: 'delete', scopeType: 'relation', scopeValue: 'owned_or_shared' },
  { appCode: 'codocs', resourceCode: 'departments', action: 'view', scopeType: 'relation', scopeValue: 'member_department' },
  { appCode: 'codocs', resourceCode: 'departments', action: 'create', scopeType: 'relation', scopeValue: 'member_department' },
  { appCode: 'codocs', resourceCode: 'departments', action: 'edit', scopeType: 'relation', scopeValue: 'member_department' },
  { appCode: 'codocs', resourceCode: 'company', action: 'view', scopeType: 'tenant', scopeValue: 'published' },
  { appCode: 'codocs', resourceCode: 'info', action: 'view', scopeType: 'tenant', scopeValue: 'published' },
  { appCode: 'codocs', resourceCode: 'reviews', action: 'view', scopeType: 'relation', scopeValue: 'participant' },
  { appCode: 'codocs', resourceCode: 'reviews', action: 'submit', scopeType: 'subject', scopeValue: 'self' },
  { appCode: 'aims', resourceCode: 'aims_overview', action: 'view', scopeType: 'relation', scopeValue: 'participant' },
  { appCode: 'aims', resourceCode: 'projects', action: 'view', scopeType: 'relation', scopeValue: 'participant' },
  { appCode: 'aims', resourceCode: 'work_items', action: 'view', scopeType: 'relation', scopeValue: 'participant' },
  { appCode: 'aims', resourceCode: 'notifications', action: 'view', scopeType: 'subject', scopeValue: 'self' }
]

export function collectBaselinePermissions(appCodes: string[]) {
  const appCodeSet = new Set(appCodes)
  return BASELINE_PERMISSIONS
    .filter(permission => appCodeSet.has(permission.appCode))
    .map(permission => ({ ...permission }))
}
