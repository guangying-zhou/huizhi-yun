import { createError } from 'h3'

// Called only after live Console service authentication and deployment binding.
// Physical app/client remain unchanged for audit; only this closed owning-domain
// pair may retain the Aims notification namespace across the worker cutover.
export function bindAimsNotificationPublisher<T extends { appCode?: string | null, actorId?: string | null }>(actor: T, body: { sourceAppCode?: unknown } | null): T & { notificationSourceApp?: 'aims' } {
  if (body?.sourceAppCode !== 'aims' || actor.appCode !== 'enterprise') return actor
  if (actor.actorId !== 'enterprise.runtime') throw createError({ statusCode: 403, statusMessage: 'notification_publisher_identity_mismatch' })
  return { ...actor, notificationSourceApp: 'aims' as const }
}
