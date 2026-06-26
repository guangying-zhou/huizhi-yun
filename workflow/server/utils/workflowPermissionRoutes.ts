export interface WorkflowRoutePermission {
  resource: string
  action: string
}

export function resolveWorkflowRoutePermission(suffix: string, method: string): WorkflowRoutePermission | null {
  if (method.toUpperCase() !== 'POST') return null

  if (/^\/tasks\/[^/]+\/approve$/.test(suffix)) {
    return { resource: 'workflow_tasks', action: 'approve' }
  }
  if (/^\/tasks\/[^/]+\/reject$/.test(suffix)) {
    return { resource: 'workflow_tasks', action: 'reject' }
  }
  if (/^\/tasks\/[^/]+\/delegate$/.test(suffix)) {
    return { resource: 'workflow_tasks', action: 'delegate' }
  }
  if (/^\/instances\/[^/]+\/cancel$/.test(suffix)) {
    return { resource: 'workflow_instances', action: 'cancel' }
  }
  if (/^\/instances\/[^/]+\/resubmit$/.test(suffix)) {
    return { resource: 'workflow_instances', action: 'resubmit' }
  }

  return null
}
