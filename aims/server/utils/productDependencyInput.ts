const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
export function productDependencyReadInput(raw: Record<string, unknown>, itemId: string) {
  return uuid(itemId) && Object.keys(raw).length === 0 ? { item_biz_id: itemId } : null
}
export function productDependencyEditInput(raw: unknown, itemId: string) {
  if (!uuid(itemId) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['expectedRevision', 'expectedItemRevision', 'predecessorIds', 'reason', 'impactNote'].includes(key))) return null
  for (const key of ['expectedRevision', 'expectedItemRevision']) if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 1) return null
  if (!Array.isArray(value.predecessorIds) || value.predecessorIds.length > 100 || value.predecessorIds.some(id => !uuid(id) || id === itemId) || new Set(value.predecessorIds).size !== value.predecessorIds.length) return null
  const reason = value.reason, impact = value.impactNote === undefined ? '' : value.impactNote
  if (typeof reason !== 'string' || !reason.trim() || typeof impact !== 'string') return null
  if ([reason, impact].some(text => !text.isWellFormed() || text.includes('\0') || [...text].length > 2000)) return null
  return { item_biz_id: itemId, expected_revision: Number(value.expectedRevision), expected_item_revision: Number(value.expectedItemRevision), predecessor_biz_ids: value.predecessorIds as string[], reason, impact_note: impact }
}
