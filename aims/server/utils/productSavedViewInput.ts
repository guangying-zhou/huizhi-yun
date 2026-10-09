import { productModelPageInput } from './productModelInput'

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
const positive = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export function productSavedViewDefinition(raw: unknown) {
  if (!record(raw) || Object.keys(raw).some(key => !['title', 'audience', 'visibility', 'cycleId', 'year', 'quarter', 'unscheduled'].includes(key))) return null
  if (typeof raw.title !== 'string' || !raw.title.isWellFormed() || !raw.title.trim() || [...raw.title].length > 200 || raw.title.includes('\0')) return null
  if (typeof raw.audience !== 'string' || !['planning', 'delivery', 'stakeholder'].includes(raw.audience) || typeof raw.visibility !== 'string' || !['personal', 'product'].includes(raw.visibility)) return null
  if (!uuid(raw.cycleId) || typeof raw.year !== 'number' || !Number.isInteger(raw.year) || raw.year < 1000 || raw.year > 9999 || typeof raw.quarter !== 'number' || !Number.isInteger(raw.quarter) || raw.quarter < 1 || raw.quarter > 4 || typeof raw.unscheduled !== 'boolean') return null
  return { title: raw.title, audience: raw.audience, visibility: raw.visibility, cycle_biz_id: raw.cycleId, year: raw.year, quarter: raw.quarter, unscheduled: raw.unscheduled }
}

export function productSavedViewWriteInput(action: 'create' | 'update' | 'delete', raw: unknown, bizId?: string) {
  const fields = ['expectedRevision', ...(action === 'create' ? [] : ['expectedViewRevision']), ...(action === 'delete' ? [] : ['definition'])]
  if (!record(raw) || Object.keys(raw).some(key => !fields.includes(key)) || !positive(raw.expectedRevision)) return null
  if (action !== 'create' && (!uuid(bizId) || !positive(raw.expectedViewRevision))) return null
  const identity = action === 'create' ? {} : { biz_id: bizId!, expected_view_revision: Number(raw.expectedViewRevision) }
  if (action === 'delete') return { ...identity, expected_revision: Number(raw.expectedRevision) }
  const definition = productSavedViewDefinition(raw.definition)
  return definition ? { ...identity, expected_revision: Number(raw.expectedRevision), definition } : null
}

export function productSavedViewReadInput(action: 'list' | 'view' | 'apply', raw: Record<string, unknown>, bizId?: string) {
  if (action !== 'list' && !uuid(bizId)) return null
  if (action === 'view') return Object.keys(raw).length ? null : { biz_id: bizId! }
  const page = productModelPageInput(raw)
  return page ? { ...page, ...(action === 'apply' ? { biz_id: bizId! } : {}) } : null
}
