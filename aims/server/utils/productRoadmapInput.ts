const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const date = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
export function productRoadmapWindowInput(raw: unknown, bizId: string) {
  if (!uuid.test(bizId) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['startsOn', 'endsOn', 'expectedRevision', 'expectedItemRevision', 'reason'].includes(key)) || !Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1 || !Number.isSafeInteger(value.expectedItemRevision) || Number(value.expectedItemRevision) < 1 || typeof value.reason !== 'string' || !value.reason.isWellFormed() || !value.reason.trim() || value.reason.includes('\0') || [...value.reason].length > 2000) return null
  if (!(value.startsOn === null && value.endsOn === null) && !(date(value.startsOn) && date(value.endsOn) && value.endsOn >= value.startsOn)) return null
  return { biz_id: bizId, starts_on: value.startsOn as string | null, ends_on: value.endsOn as string | null, expected_revision: Number(value.expectedRevision), expected_item_revision: Number(value.expectedItemRevision), reason: value.reason }
}
export function productRoadmapRoute(path: string | undefined, method: string) {
  if (!path) return null
  const [kind, id, ...extra] = path.split('/')
  if (kind === 'commit' && id && uuid.test(id) && !extra.length) return { id, action: 'commit' as const, methodAllowed: method === 'POST' }
  if (kind !== 'windows' || !id || !uuid.test(id) || extra.length) return null
  return { id, action: method === 'GET' ? 'window-view' as const : 'window-edit' as const, methodAllowed: method === 'GET' || method === 'PATCH' }
}

export function productQuarterRoadmapInput(value: Record<string, unknown>) {
  if (Object.keys(value).some(key => !['cycleId', 'year', 'quarter', 'unscheduled', 'page', 'pageSize'].includes(key))) return null
  const integer = (raw: unknown, min: number, max: number) => typeof raw === 'string' && /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) >= min && Number(raw) <= max ? Number(raw) : null
  const year = integer(value.year, 1000, 9999), quarter = integer(value.quarter, 1, 4)
  const page = integer(value.page ?? '1', 1, 1000000), pageSize = integer(value.pageSize ?? '20', 1, 100)
  if (typeof value.cycleId !== 'string' || !uuid.test(value.cycleId) || year === null || quarter === null || page === null || pageSize === null || (value.unscheduled !== undefined && value.unscheduled !== 'true' && value.unscheduled !== 'false')) return null
  return { cycle_biz_id: value.cycleId, year, quarter, unscheduled: value.unscheduled === 'true', page, page_size: pageSize }
}

export function productRoadmapCommitInput(raw: unknown, id: string) {
  if (!uuid.test(id) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const revisions = ['expectedRevision', 'expectedItemRevision', 'expectedCycleRevision', 'expectedQueueRevision']
  if (Object.keys(value).some(key => ![...revisions, 'expectedPreviousId', 'cycleId', 'reason'].includes(key)) || revisions.some(key => !Number.isSafeInteger(value[key]) || Number(value[key]) < 1) || !Number.isSafeInteger(value.expectedPreviousId) || Number(value.expectedPreviousId) < 0 || typeof value.cycleId !== 'string' || !uuid.test(value.cycleId) || typeof value.reason !== 'string' || !value.reason.isWellFormed() || !value.reason.trim() || value.reason.includes('\0') || [...value.reason].length > 2000) return null
  return { item_biz_id: id, cycle_biz_id: value.cycleId, expected_revision: Number(value.expectedRevision), expected_item_revision: Number(value.expectedItemRevision), expected_cycle_revision: Number(value.expectedCycleRevision), expected_queue_revision: Number(value.expectedQueueRevision), expected_previous_id: Number(value.expectedPreviousId), reason: value.reason }
}

export function productRoadmapHistoryInput(value: Record<string, unknown>, id: string) {
  if (!uuid.test(id) || Object.keys(value).some(key => !['page', 'pageSize'].includes(key))) return null
  const integer = (raw: unknown, max: number) => typeof raw === 'string' && /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) <= max ? Number(raw) : null
  const page = integer(value.page ?? '1', 1000000), pageSize = integer(value.pageSize ?? '20', 100)
  return page === null || pageSize === null ? null : { biz_id: id, page, page_size: pageSize }
}
