const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, limit = 2000): value is string => typeof value === 'string' && !!value.trim() && value.isWellFormed() && !value.includes('\0') && [...value].length <= limit

export function productSelectionInput(raw: unknown, cycleId: string, itemId: string) {
  if (!uuid(cycleId) || !uuid(itemId) || !record(raw)) return null
  if (Object.keys(raw).some(key => !['expectedRevision', 'expectedCycleRevision', 'expectedItemRevision', 'expectedQueueRevision', 'expectedAssessmentId', 'reason', 'exceptions'].includes(key))) return null
  for (const key of ['expectedRevision', 'expectedCycleRevision', 'expectedItemRevision', 'expectedQueueRevision', 'expectedAssessmentId']) if (!Number.isSafeInteger(raw[key]) || Number(raw[key]) < 1) return null
  if (!text(raw.reason) || !Array.isArray(raw.exceptions) || raw.exceptions.length > 100) return null
  const exceptions = productDecisionExceptionsInput(raw.exceptions)
  if (!exceptions) return null
  return { cycle_biz_id: cycleId, item_biz_id: itemId, expected_revision: Number(raw.expectedRevision), expected_cycle_revision: Number(raw.expectedCycleRevision), expected_item_revision: Number(raw.expectedItemRevision), expected_queue_revision: Number(raw.expectedQueueRevision), expected_assessment_id: Number(raw.expectedAssessmentId), reason: raw.reason, exceptions }
}

export function productDecisionExceptionsInput(raw: unknown) {
  if (!Array.isArray(raw) || raw.length > 100) return null
  const exceptions: { code: string, item_id?: string, predecessor_id?: string, category?: string, reason: string, responsible_uid: string, impact: string }[] = []
  const seen = new Set<string>()
  for (const value of raw) {
    if (!record(value) || Object.keys(value).some(key => !['code', 'itemId', 'predecessorId', 'category', 'reason', 'responsibleUid', 'impact'].includes(key))) return null
    if (!text(value.reason) || !text(value.impact) || !text(value.responsibleUid, 64) || value.responsibleUid !== value.responsibleUid.trim()) return null
    const code = value.code
    if (code === 'capacity_exceeded') {
      if (value.itemId !== undefined || value.predecessorId !== undefined || value.category !== undefined) return null
    } else if (code === 'category_capacity_exceeded') {
      if (typeof value.category !== 'string' || !['reliability', 'usability', 'growth'].includes(value.category) || value.itemId !== undefined || value.predecessorId !== undefined) return null
    } else if (code === 'effort_required' || code === 'dependency_unresolved') {
      if (!uuid(value.itemId) || value.category !== undefined) return null
      if (code === 'dependency_unresolved' ? !uuid(value.predecessorId) || value.predecessorId === value.itemId : value.predecessorId !== undefined) return null
    } else return null
    const key = JSON.stringify([code, value.itemId, value.predecessorId, value.category])
    if (seen.has(key)) return null
    seen.add(key)
    exceptions.push({ code, ...(value.itemId === undefined ? {} : { item_id: value.itemId as string }), ...(value.predecessorId === undefined ? {} : { predecessor_id: value.predecessorId as string }), ...(value.category === undefined ? {} : { category: value.category as string }), reason: value.reason, responsible_uid: value.responsibleUid, impact: value.impact })
  }
  return exceptions
}
