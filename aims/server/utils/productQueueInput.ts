export function productQueueMoveInput(raw: unknown, cycleId: string) {
  const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  if (!uuid(cycleId) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['expectedRevision', 'expectedCycleRevision', 'expectedQueueRevision', 'itemId', 'beforeId', 'afterId', 'reason'].includes(key))) return null
  for (const key of ['expectedRevision', 'expectedCycleRevision', 'expectedQueueRevision']) if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 1) return null
  if (!uuid(value.itemId) || (value.beforeId === undefined) === (value.afterId === undefined)) return null
  const anchor = value.beforeId ?? value.afterId
  if (!uuid(anchor) || anchor === value.itemId) return null
  if (typeof value.reason !== 'string' || !value.reason.trim() || !value.reason.isWellFormed() || value.reason.includes('\0') || [...value.reason].length > 2000) return null
  return { cycle_biz_id: cycleId, expected_revision: Number(value.expectedRevision), expected_cycle_revision: Number(value.expectedCycleRevision), expected_queue_revision: Number(value.expectedQueueRevision), move: { item_id: value.itemId, ...(value.beforeId === undefined ? { after_id: anchor } : { before_id: anchor }) }, reason: value.reason }
}
