/** Callback business identity and frozen relative URL never change. */
export function workflowCallbackTarget(appCode: string) {
  if (appCode === 'aims') return { appCode: 'enterprise', audience: 'enterprise', scope: 'enterprise:workflow-callback:execute' }
  return { appCode, audience: appCode, scope: 'workflow:callback' }
}
