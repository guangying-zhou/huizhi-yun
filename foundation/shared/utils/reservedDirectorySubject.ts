/**
 * Directory subjects that are never people.
 *
 * `system:unassigned` marks a business object whose historical owner could not
 * be mapped to a Directory user (WizBiz migration). It is a display-only
 * built-in: it cannot sign in, cannot hold or be granted any authorization,
 * never appears among selectable users, and only the migration lane may write
 * it as an owner.
 */
export const UNASSIGNED_OWNER_UID = 'system:unassigned'
export const UNASSIGNED_OWNER_LABEL = '未分配'

export function isReservedDirectorySubject(uid: unknown) {
  const value = String(uid ?? '').trim().toLowerCase()
  return value === 'system' || value.startsWith('system:') || value.startsWith('client:')
}
