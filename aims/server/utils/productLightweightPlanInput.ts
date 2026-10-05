import { productVersionID } from './productVersionInput.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const decimal = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/

function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function boundedText(value: unknown, max: number, required = false): value is string {
  return typeof value === 'string' && value.isWellFormed() && !value.includes('\0') && [...value].length <= max && (!required || !!value.trim())
}

function date(value: unknown): string | null {
  if (value === '' || value === null) return ''
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null
}

function personDays(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !decimal.test(value) || !Number.isFinite(Number(value)) || Number(value) > 100000000) return undefined as never
  return value
}

function revisions(v: Record<string, unknown>, names: string[]) {
  if (!names.every(name => positive(v[name]))) return null
  return Object.fromEntries(names.map(name => [name.replace(/[A-Z]/g, char => `_${char.toLowerCase()}`), Number(v[name])]))
}

export function productLightweightPlanEditInput(raw: unknown, versionID: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !positive(versionID)) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(key => !['expectedRevision', 'expectedVersionRevision', 'expectedPlanRevision', 'goal', 'startsOn', 'plannedReleaseDate', 'availablePersonDays', 'reservePersonDays', 'reason'].includes(key))) return null
  const expected = revisions(v, ['expectedRevision', 'expectedVersionRevision', 'expectedPlanRevision'])
  const startsOn = date(v.startsOn), release = date(v.plannedReleaseDate)
  const available = personDays(v.availablePersonDays), reserve = personDays(v.reservePersonDays)
  const reason = v.reason === undefined ? '' : v.reason
  if (!expected || !boundedText(v.goal, 2000) || startsOn === null || release === null || available === undefined || reserve === undefined || !boundedText(reason, 2000)) return null
  return { version_id: versionID, ...expected, goal: v.goal, starts_on: startsOn, planned_release_date: release, available_person_days: available, reserve_person_days: reserve, reason }
}

export function productLightweightPlanItemPageInput(raw: Record<string, unknown>) {
  if (Object.keys(raw).some(key => !['page', 'pageSize', 'keyword'].includes(key))) return null
  const page = raw.page === undefined ? 1 : typeof raw.page === 'string' && /^[1-9]\d*$/.test(raw.page) ? Number(raw.page) : NaN
  const pageSize = raw.pageSize === undefined ? 20 : typeof raw.pageSize === 'string' && /^[1-9]\d*$/.test(raw.pageSize) ? Number(raw.pageSize) : NaN
  const keyword = raw.keyword === undefined ? '' : raw.keyword
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || !boundedText(keyword, 200)) return null
  return { page, page_size: pageSize, keyword }
}

export function productLightweightPlanItemCreateInput(raw: unknown, versionID: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !positive(versionID)) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(key => !['expectedRevision', 'expectedVersionRevision', 'expectedPlanRevision', 'requestBizId', 'expectedRequestRevision', 'scopeSummary', 'estimatePersonDays', 'acceptanceCriteria', 'sortOrder', 'adoptRequest', 'reason'].includes(key))) return null
  const expected = revisions(v, ['expectedRevision', 'expectedVersionRevision', 'expectedPlanRevision', 'expectedRequestRevision'])
  const estimate = personDays(v.estimatePersonDays)
  const reason = v.reason === undefined ? '' : v.reason
  if (!expected || typeof v.requestBizId !== 'string' || !uuid.test(v.requestBizId) || !boundedText(v.scopeSummary, 10000, true) || !boundedText(v.acceptanceCriteria, 10000) || estimate === undefined || !Number.isSafeInteger(v.sortOrder) || Number(v.sortOrder) < -2147483648 || Number(v.sortOrder) > 2147483647 || typeof v.adoptRequest !== 'boolean' || !boundedText(reason, 2000)) return null
  return { version_id: versionID, ...expected, request_biz_id: v.requestBizId, scope_summary: v.scopeSummary, estimate_person_days: estimate, acceptance_criteria: v.acceptanceCriteria, sort_order: Number(v.sortOrder), adopt_request: v.adoptRequest, reason }
}

export function productLightweightPlanItemEditInput(raw: unknown, versionID: number, scopeID: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !positive(versionID) || !positive(scopeID)) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(key => !['expectedRevision', 'expectedVersionRevision', 'expectedPlanRevision', 'expectedScopeRevision', 'scopeSummary', 'estimatePersonDays', 'acceptanceCriteria', 'sortOrder', 'reason'].includes(key))) return null
  const expected = revisions(v, ['expectedRevision', 'expectedVersionRevision', 'expectedPlanRevision', 'expectedScopeRevision'])
  const estimate = personDays(v.estimatePersonDays)
  const reason = v.reason === undefined ? '' : v.reason
  if (!expected || !boundedText(v.scopeSummary, 10000, true) || !boundedText(v.acceptanceCriteria, 10000) || estimate === undefined || !Number.isSafeInteger(v.sortOrder) || Number(v.sortOrder) < -2147483648 || Number(v.sortOrder) > 2147483647 || !boundedText(reason, 2000)) return null
  return { version_id: versionID, scope_id: scopeID, ...expected, scope_summary: v.scopeSummary, estimate_person_days: estimate, acceptance_criteria: v.acceptanceCriteria, sort_order: Number(v.sortOrder), reason }
}

export function productLightweightPlanItemDeleteInput(raw: unknown, versionID: number, scopeID: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !positive(versionID) || !positive(scopeID)) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(key => !['expectedRevision', 'expectedVersionRevision', 'expectedPlanRevision', 'expectedScopeRevision', 'reason'].includes(key))) return null
  const expected = revisions(v, ['expectedRevision', 'expectedVersionRevision', 'expectedPlanRevision', 'expectedScopeRevision'])
  if (!expected || !boundedText(v.reason, 2000, true)) return null
  return { version_id: versionID, scope_id: scopeID, ...expected, reason: v.reason }
}

export function productLightweightPlanConfirmInput(raw: unknown, versionID: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !positive(versionID)) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(key => !['expectedRevision', 'expectedVersionRevision', 'expectedPlanRevision', 'expectedScopeRevision'].includes(key))) return null
  const expected = revisions(v, ['expectedRevision', 'expectedVersionRevision', 'expectedPlanRevision', 'expectedScopeRevision'])
  if (!expected) return null
  return { version_id: versionID, ...expected }
}

export function productLightweightPlanIDs(version: unknown, scope?: unknown) {
  const versionID = productVersionID(version)
  const scopeID = scope === undefined ? undefined : productVersionID(scope)
  return versionID === null || scopeID === null ? null : { versionID, scopeID }
}
