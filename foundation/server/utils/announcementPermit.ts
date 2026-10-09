export const announcementOperations = ['surfaces', 'departments', 'list', 'detail', 'read', 'admin-list', 'save', 'withdraw', 'delivery-claim', 'delivery-ack', 'deliver'] as const
export type AnnouncementOperation = typeof announcementOperations[number]
export function announcementPermission(op: AnnouncementOperation) {
  return ['departments', 'admin-list', 'save', 'withdraw', 'delivery-claim', 'delivery-ack', 'deliver'].includes(op) ? 'admin' : 'view'
}
export function announcementPermitPath(path: string) {
  return /^\/v1\/(?:enterprise\/)?console\/announcements:(surfaces|departments|list|detail|read|admin-list|save|withdraw|delivery-claim|delivery-ack|deliver)$/.test(path)
}
export function announcementPermitCanonical(method: string, target: string, body: Record<string, unknown>, key: string) {
  const p = body.authorization as Record<string, unknown>
  return JSON.stringify(['hzy-console-announcement-permit.v1', method, target, key,
    ...['actorUid', 'tenant', 'deployment', 'resource', 'action', 'operation', 'expiresAt', 'bundleVersion', 'bundleHash', 'policyRevision'].map(k => p[k]), body.payload]).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}
