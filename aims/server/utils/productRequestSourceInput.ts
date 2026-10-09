export function productRequestSourceInput(raw: unknown, bizId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bizId)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['expectedRevision', 'expectedRequestRevision', 'note', 'evidenceDate', 'kind', 'direction'].includes(key))) return null
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1 || !Number.isSafeInteger(value.expectedRequestRevision) || Number(value.expectedRequestRevision) < 1) return null
  if (typeof value.note !== 'string' || !value.note.trim() || [...value.note].length > 10000 || value.note.includes('\0') || !value.note.isWellFormed()) return null
  if (typeof value.kind !== 'string' || !['fact', 'assumption'].includes(value.kind) || typeof value.direction !== 'string' || !['supporting', 'opposing', 'neutral'].includes(value.direction)) return null
  const date = value.evidenceDate === undefined ? null : value.evidenceDate
  if (date !== null) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) < 1000) return null
    const parsed = new Date(`${date}T00:00:00.000Z`)
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) return null
  }
  return { biz_id: bizId, expected_revision: Number(value.expectedRevision), expected_request_revision: Number(value.expectedRequestRevision), note: value.note, evidence_date: date, kind: value.kind, direction: value.direction }
}

export function productRequestSourceDeleteInput(raw: unknown, bizId: string, sourceId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bizId)) return null
  if (!/^[1-9][0-9]*$/.test(sourceId) || !Number.isSafeInteger(Number(sourceId))) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['expectedRevision', 'expectedRequestRevision', 'expectedSourceRevision', 'reason'].includes(key))) return null
  for (const key of ['expectedRevision', 'expectedRequestRevision', 'expectedSourceRevision']) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 1) return null
  }
  if (typeof value.reason !== 'string' || !value.reason.trim() || [...value.reason].length > 2000 || value.reason.includes('\0') || !value.reason.isWellFormed()) return null
  return { biz_id: bizId, source_id: Number(sourceId), expected_revision: Number(value.expectedRevision), expected_request_revision: Number(value.expectedRequestRevision), expected_source_revision: Number(value.expectedSourceRevision), reason: value.reason }
}
