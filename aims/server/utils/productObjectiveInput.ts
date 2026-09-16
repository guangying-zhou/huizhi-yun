import { productRequestPageInput } from './productRequestInput'

const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.isWellFormed() && [...v].length <= max && !v.includes('\0')
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const date = (v: unknown): v is string => typeof v === 'string' && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
const decimal = (v: unknown): v is string => typeof v === 'string' && /^-?\d{1,14}(\.\d{1,6})?$/.test(v)
const scaled = (v: string) => {
  const negative = v.startsWith('-')
  const [whole, fraction = ''] = (negative ? v.slice(1) : v).split('.')
  return BigInt(`${whole}${fraction.padEnd(6, '0')}`) * (negative ? -1n : 1n)
}

export function productObjectivePageInput(raw: Record<string, unknown>) {
  if (Object.keys(raw).some(key => !['status', 'page', 'pageSize'].includes(key))) return null
  const status = raw.status ?? ''
  if (typeof status !== 'string' || !['', 'draft', 'active', 'closed', 'archived'].includes(status)) return null
  const page = productRequestPageInput({ page: raw.page, pageSize: raw.pageSize })
  return page ? { status, page: page.page, page_size: page.page_size } : null
}

export function productObjectiveCreateInput(raw: unknown) {
  if (!record(raw) || Object.keys(raw).some(key => !['title', 'description', 'startsOn', 'endsOn', 'ownerUid', 'metric', 'expectedRevision'].includes(key))) return null
  const { title, startsOn, endsOn, ownerUid, metric, expectedRevision } = raw
  const description = raw.description ?? ''
  if (!text(title, 255) || !title.trim() || !text(description, 10000) || !text(ownerUid, 64) || !ownerUid || ownerUid !== ownerUid.trim() || !date(startsOn) || !date(endsOn) || endsOn < startsOn || !Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1) return null
  if (!record(metric) || Object.keys(metric).some(key => !['name', 'unit', 'measurementDefinition', 'direction', 'baselineValue', 'targetValue'].includes(key))) return null
  const { name, unit, measurementDefinition, direction, baselineValue, targetValue } = metric
  if (!text(name, 255) || !name.trim() || !text(unit, 64) || !unit.trim() || !text(measurementDefinition, 2000) || !measurementDefinition.trim() || !decimal(baselineValue) || !decimal(targetValue)) return null
  if (!((direction === 'increase' && scaled(targetValue) > scaled(baselineValue)) || (direction === 'decrease' && scaled(targetValue) < scaled(baselineValue)))) return null
  return { title, description, starts_on: startsOn, ends_on: endsOn, owner_uid: ownerUid, expected_revision: Number(expectedRevision), metric: { name, unit, measurement_definition: measurementDefinition, direction, baseline_value: baselineValue, target_value: targetValue } }
}

export type ProductObjectiveAction = 'cycle-map' | 'cycle-revoke' | 'item-link' | 'edit' | 'observe' | 'activate' | 'close' | 'reopen' | 'archive'

export function productObjectiveActionInput(raw: unknown, objectiveID: number, action: ProductObjectiveAction) {
  if (!record(raw) || !Number.isSafeInteger(objectiveID) || objectiveID < 1) return null
  if (action === 'cycle-map' || action === 'cycle-revoke') {
    const allowed = action === 'cycle-map' ? ['cycleId', 'expectedCycleRevision', 'expectedRevision', 'expectedObjectiveRevision', 'reason'] : ['mappingId', 'expectedRevision', 'expectedObjectiveRevision', 'reason']
    const ids = action === 'cycle-map' ? [raw.cycleId, raw.expectedCycleRevision] : [raw.mappingId]
    if (Object.keys(raw).some(key => !allowed.includes(key)) || ![...ids, raw.expectedRevision, raw.expectedObjectiveRevision].every(value => Number.isSafeInteger(value) && Number(value) > 0) || !text(raw.reason, 2000) || !raw.reason.trim()) return null
    const base = { objective_id: objectiveID, expected_revision: Number(raw.expectedRevision), expected_objective_revision: Number(raw.expectedObjectiveRevision), reason: raw.reason }
    return action === 'cycle-map' ? { ...base, cycle_id: Number(raw.cycleId), expected_cycle_revision: Number(raw.expectedCycleRevision) } : { ...base, mapping_id: Number(raw.mappingId) }
  }
  if (action === 'item-link') {
    if (Object.keys(raw).some(key => !['expectedRevision', 'expectedObjectiveRevision', 'planningItemId', 'expectedPlanningRevision', 'contributionNote', 'remove', 'reason'].includes(key))) return null
    if (![raw.expectedRevision, raw.expectedObjectiveRevision, raw.planningItemId, raw.expectedPlanningRevision].every(value => Number.isSafeInteger(value) && Number(value) > 0) || typeof raw.remove !== 'boolean' || !text(raw.contributionNote, 2000) || (!raw.remove && !raw.contributionNote.trim()) || (raw.remove && raw.contributionNote !== '') || !text(raw.reason, 2000) || !raw.reason.trim()) return null
    return { objective_id: objectiveID, planning_item_id: Number(raw.planningItemId), expected_revision: Number(raw.expectedRevision), expected_objective_revision: Number(raw.expectedObjectiveRevision), expected_planning_revision: Number(raw.expectedPlanningRevision), contribution_note: raw.contributionNote, remove: raw.remove, reason: raw.reason }
  }
  if (action === 'edit') {
    const { expectedObjectiveRevision, reason, ...draft } = raw
    if (!Number.isSafeInteger(expectedObjectiveRevision) || Number(expectedObjectiveRevision) < 1 || !text(reason, 2000) || !reason.trim()) return null
    const input = productObjectiveCreateInput(draft)
    return input ? { ...input, objective_id: objectiveID, expected_objective_revision: Number(expectedObjectiveRevision), reason } : null
  }
  const allowed = action === 'observe' ? ['expectedRevision', 'expectedObjectiveRevision', 'observedOn', 'measuredValue', 'evidence', 'note', 'correctionOfId', 'correctionReason'] : ['expectedRevision', 'expectedObjectiveRevision', 'reason']
  if (Object.keys(raw).some(key => !allowed.includes(key)) || !Number.isSafeInteger(raw.expectedRevision) || Number(raw.expectedRevision) < 1 || !Number.isSafeInteger(raw.expectedObjectiveRevision) || Number(raw.expectedObjectiveRevision) < 1) return null
  const base = { objective_id: objectiveID, expected_revision: Number(raw.expectedRevision), expected_objective_revision: Number(raw.expectedObjectiveRevision) }
  if (action === 'observe') {
    const note = raw.note ?? ''
    if (!date(raw.observedOn) || !decimal(raw.measuredValue) || !text(raw.evidence, 10000) || !raw.evidence.trim() || !text(note, 10000)) return null
    const correcting = Object.hasOwn(raw, 'correctionOfId') || Object.hasOwn(raw, 'correctionReason')
    if (correcting && (!Number.isSafeInteger(raw.correctionOfId) || Number(raw.correctionOfId) < 1 || !text(raw.correctionReason, 2000) || !raw.correctionReason.trim())) return null
    return { ...base, observed_on: raw.observedOn, measured_value: raw.measuredValue, evidence: raw.evidence, note, ...(correcting ? { correction_of_id: Number(raw.correctionOfId), correction_reason: raw.correctionReason as string } : {}) }
  }
  if (!['activate', 'close', 'reopen', 'archive'].includes(action) || !text(raw.reason, 2000) || !raw.reason.trim()) return null
  return { ...base, action, reason: raw.reason }
}

export function productObjectiveObservationPageInput(raw: Record<string, unknown>, objectiveID: number) {
  if (!Number.isSafeInteger(objectiveID) || objectiveID < 1 || Object.keys(raw).some(key => !['page', 'pageSize'].includes(key))) return null
  const page = productRequestPageInput(raw)
  return page ? { objective_id: objectiveID, page: page.page, page_size: page.page_size } : null
}

export function productObjectiveRoute(path: string | undefined, method: string) {
  if (!path) return null
  if (path === 'permissions') return { id: undefined, action: 'permissions' as const, methodAllowed: method === 'GET' }
  const [id, suffix, ...extra] = path.split('/')
  if (!id || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || extra.length) return null
  if (suffix === undefined) return { id, action: 'view' as const, methodAllowed: method === 'GET' }
  if (suffix === 'cycles') return { id, action: 'cycles' as const, methodAllowed: method === 'GET' }
  if (suffix === 'items') return { id, action: 'items' as const, methodAllowed: method === 'GET' }
  if (suffix === 'observations') return { id, action: 'observations' as const, methodAllowed: method === 'GET' }
  if (!['cycle-map', 'cycle-revoke', 'item-link', 'edit', 'observe', 'activate', 'close', 'reopen', 'archive'].includes(suffix)) return null
  return { id, action: suffix as ProductObjectiveAction, methodAllowed: method === 'POST' }
}
