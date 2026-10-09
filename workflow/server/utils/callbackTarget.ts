/** Callback business identity and frozen relative URL never change. */
export function workflowCallbackTarget(appCode: string, resource = '', action = '', path = '') {
  if (appCode === 'finance' && ((resource === 'invoices' && action === 'request') || (resource === 'expenses' && ['claim', 'project_expense', 'payment'].includes(action))) && ['/api/v1/finance/workflow/callback', '/finance/api/v1/finance/workflow/callback'].includes(path)) return { appCode: 'enterprise', audience: 'enterprise', scope: 'enterprise:workflow-callback:execute', deliveryPath: '/api/v1/service/workflow/callback' }
  if (appCode === 'altoc' && ['quotation', 'contract'].includes(resource) && action === 'approve' && path === '/api/v1/service/workflow/callback') return { appCode: 'enterprise', audience: 'enterprise', scope: 'enterprise:workflow-callback:execute' }
  if (appCode === 'people' && resource === 'assignments' && action === 'change' && path === '/api/v1/service/workflow/callback') return { appCode: 'enterprise', audience: 'enterprise', scope: 'enterprise:workflow-callback:execute' }
  if (appCode === 'aims') return { appCode: 'enterprise', audience: 'enterprise', scope: 'enterprise:workflow-callback:execute' }
  return { appCode, audience: appCode, scope: 'workflow:callback' }
}
