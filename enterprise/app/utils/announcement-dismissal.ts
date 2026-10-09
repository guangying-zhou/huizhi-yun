import type { Announcement } from '../../../console/shared/announcements'

// Use the verified session identity, not policy revision: re-signing a policy
// must not redisplay an unchanged announcement. Tenant/deployment stay isolated.
export function announcementDismissalKey(scope: string, item: Pick<Announcement, 'id' | 'revision'>): string | undefined {
  try {
    const fields: unknown = JSON.parse(scope)
    if (!Array.isArray(fields) || typeof fields[0] !== 'string' || !fields[0] || typeof fields[1] !== 'string' || !fields[1]) return undefined
    if (!item.id || !Number.isSafeInteger(item.revision) || item.revision < 1) return undefined
    return `hzy:announcement-dismissed:${JSON.stringify([fields[0], fields[1], fields[2] || '', fields[4] || '', item.id, item.revision])}`
  } catch {
    return undefined
  }
}
