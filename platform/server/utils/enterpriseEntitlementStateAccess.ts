import { createError } from 'h3'

/** Input context must be established by platform-access middleware, never request headers/body. */
export async function requireEnterpriseEntitlementStateAccess(
  context: { platformAccessScope?: unknown, platformUid?: unknown },
  loadAuthorization: (uid: string) => Promise<{ resources: Record<string, string[]> }>
) {
  const uid = typeof context.platformUid === 'string' ? context.platformUid.trim() : ''
  if (!uid) throw createError({ statusCode: 401, message: 'Authenticated Platform operator required' })
  if (context.platformAccessScope !== 'ops') throw createError({ statusCode: 403, message: 'Platform operations scope required' })
  const authorization = await loadAuthorization(uid)
  // A commercial qualification change does not grant personnel permissions. Require existing
  // explicit subscription admin, even when middleware's general POST rule permits edit.
  if (!authorization.resources['ops.subscriptions']?.includes('admin')) throw createError({ statusCode: 403, message: 'Subscription admin permission required' })
  return uid
}

export function parseEnterpriseStateRequest(body: unknown, tenantCode: string, actorUid: string) {
  const allowed = new Set(['action', 'operationId', 'expectedRevision', 'reason'])
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, message: 'Invalid enterprise state command' })
  const record = body as Record<string, unknown>
  if (Object.keys(record).some(key => !allowed.has(key)) || !['suspend', 'revoke', 'restore'].includes(String(record.action)) || typeof record.operationId !== 'string' || typeof record.reason !== 'string' || !Number.isSafeInteger(record.expectedRevision)) {
    throw createError({ statusCode: 400, message: 'Invalid enterprise state command; tenant and actor cannot be overridden' })
  }
  return { tenantCode, actorUid, action: record.action as 'suspend' | 'revoke' | 'restore', operationId: record.operationId, reason: record.reason, expectedRevision: record.expectedRevision as number }
}
