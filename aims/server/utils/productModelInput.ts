import { hasProductControlCharacter } from './productWorkspaceInput'

const builtin = 'weighted-value-effort-v1'
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.isWellFormed() && !!value.trim() && [...value].length <= max && !value.includes('\0')
export const productModelVersion = (value: unknown): value is string => text(value, 64) && value === value.trim() && !hasProductControlCharacter(value) && !value.includes('/')

export function productModelCreateInput(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['expectedRevision', 'title', 'reason', 'version', 'strategic', 'userValue', 'business', 'risk'].includes(key)) || !positive(value.expectedRevision) || !text(value.title, 200) || !text(value.reason, 2000) || !productModelVersion(value.version) || value.version === builtin) return null
  const weights = [value.strategic, value.userValue, value.business, value.risk]
  if (weights.some(weight => typeof weight !== 'number' || !Number.isInteger(weight) || weight < 0 || weight > 100 || weight % 5 !== 0) || (weights as number[]).reduce((sum, weight) => sum + weight, 0) !== 100) return null
  return { expected_revision: value.expectedRevision, title: value.title, reason: value.reason, model: { version: value.version, strategic: Number(value.strategic), user_value: Number(value.userValue), business: Number(value.business), risk: Number(value.risk) } }
}

export function productModelSelectInput(raw: unknown, cycleId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cycleId) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['expectedRevision', 'expectedCycleRevision', 'modelVersion', 'reason'].includes(key)) || !positive(value.expectedRevision) || !positive(value.expectedCycleRevision) || !productModelVersion(value.modelVersion) || !text(value.reason, 2000)) return null
  return { biz_id: cycleId, model_version: value.modelVersion, expected_revision: value.expectedRevision, expected_cycle_revision: value.expectedCycleRevision, reason: value.reason }
}

export function productModelPageInput(value: Record<string, unknown>) {
  if (Object.keys(value).some(key => !['page', 'pageSize'].includes(key))) return null
  const integer = (raw: unknown, max: number) => typeof raw === 'string' && /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) <= max ? Number(raw) : null
  const page = integer(value.page ?? '1', 1000000), pageSize = integer(value.pageSize ?? '20', 100)
  return page === null || pageSize === null ? null : { page, page_size: pageSize }
}

export function productRICEModelCreateInput(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const fields = ['expectedRevision', 'title', 'reason', 'version', 'reachUnit', 'reachDefinition', 'reachStartsOn', 'reachEndsOn', 'sourceDefinition']
  if (Object.keys(value).some(key => !fields.includes(key)) || !positive(value.expectedRevision) || !text(value.title, 200) || !text(value.reason, 2000) || !productModelVersion(value.version) || value.version === builtin || !['unique_users', 'unique_customer_organizations'].includes(String(value.reachUnit)) || typeof value.reachUnit !== 'string' || !text(value.reachDefinition, 2000) || !text(value.sourceDefinition, 2000)) return null
  const date = (raw: unknown) => {
    if (typeof raw !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(raw)) return null
    const parsed = new Date(raw + 'T00:00:00.000Z')
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? parsed.getTime() : null
  }
  const start = date(value.reachStartsOn), end = date(value.reachEndsOn)
  if (start === null || end === null || end < start || end - start > 366 * 86400000) return null
  return { expected_revision: value.expectedRevision, title: value.title, reason: value.reason, model: { version: value.version, reach_unit: value.reachUnit, reach_definition: value.reachDefinition, reach_starts_on: value.reachStartsOn, reach_ends_on: value.reachEndsOn, source_definition: value.sourceDefinition } }
}
