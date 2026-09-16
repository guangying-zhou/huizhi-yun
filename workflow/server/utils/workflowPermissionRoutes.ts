export interface WorkflowRoutePermission {
  resource: string
  action: string
}

export function resolveWorkflowRoutePermission(suffix: string, method: string): WorkflowRoutePermission | null {
  const normalizedMethod = method.toUpperCase()

  const adminPermission = resolveAdminRoutePermission(suffix, normalizedMethod)
  if (adminPermission) return adminPermission

  if (normalizedMethod !== 'POST') return null

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

export function resolveWorkflowProxyAuthorizationPurpose(suffix: string, method: string): string | null {
  if (method.toUpperCase() !== 'POST') return null
  if (/^\/tasks\/[^/]+\/approve$/.test(suffix)) return 'task_approve'
  if (/^\/tasks\/[^/]+\/reject$/.test(suffix)) return 'task_reject'
  if (/^\/tasks\/[^/]+\/delegate$/.test(suffix)) return 'task_delegate'
  if (/^\/instances\/[^/]+\/cancel$/.test(suffix)) return 'instance_cancel'
  if (/^\/instances\/[^/]+\/resubmit$/.test(suffix)) return 'instance_resubmit'
  return null
}

function resolveAdminRoutePermission(suffix: string, method: string): WorkflowRoutePermission | null {
  const resource = adminResourceFor(suffix)
  if (!resource) return null

  if (method === 'GET') return { resource, action: 'view' }
  if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
    return { resource, action: 'edit' }
  }

  return null
}

function adminResourceFor(suffix: string) {
  if (/^\/admin\/action-defs(?:\/[^/]+)?$/.test(suffix)) return 'action_defs'
  if (/^\/admin\/flow-schemas(?:\/[^/]+)?$/.test(suffix)) return 'flow_schemas'
  if (suffix === '/admin/flow-schemas/templates') return 'flow_schemas'
  if (/^\/admin\/form-schemas(?:\/[^/]+)?$/.test(suffix)) return 'form_schemas'
  if (/^\/admin\/routes(?:\/[^/]+)?$/.test(suffix)) return 'route_rules'
  return ''
}
