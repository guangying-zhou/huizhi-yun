export const feedbackOperations = ['attachment-put', 'attachment-read', 'options', 'draft', 'submit', 'list', 'detail', 'admin-list', 'cleanup-media', 'retry', 'cancel', 'settings-get', 'settings-save'] as const
export type FeedbackOperation = typeof feedbackOperations[number]
export function feedbackPermission(op: FeedbackOperation) {
  if (op === 'settings-get' || op === 'settings-save') return { resource: 'feedback-settings', action: op === 'settings-get' ? 'view' : 'edit' }
  return { resource: 'feedback', action: ['attachment-put', 'options', 'draft', 'submit'].includes(op) ? 'submit' : op === 'retry' ? 'retry' : ['cancel', 'cleanup-media'].includes(op) ? 'admin' : 'view' }
}
export function feedbackPermitPath(path: string) {
  return /^\/v1\/(?:enterprise\/)?console\/feedback:(attachment-put|attachment-read|options|draft|submit|list|detail|admin-list|cleanup-media|retry|cancel|settings-get|settings-save)$/.test(path)
}
export function feedbackPermitCanonical(method: string, target: string, body: Record<string, unknown>, key: string) {
  const p = body.authorization as Record<string, unknown>
  return JSON.stringify(['hzy-console-feedback-permit.v1', method, target, key,
    ...['actorUid', 'tenant', 'deployment', 'resource', 'action', 'operation', 'expiresAt', 'bundleVersion', 'bundleHash', 'policyRevision', 'global'].map(k => p[k]), body.payload]).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}
