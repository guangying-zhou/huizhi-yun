import { productModelPageInput, productModelVersion } from './productModelInput'

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
const positive = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const text = (value: unknown): value is string => typeof value === 'string' && value.isWellFormed() && !!value.trim() && [...value].length <= 2000 && !value.includes('\0')

export function productReachCreateInput(raw: unknown, itemId: string) {
  if (!uuid(itemId) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const revisions = ['expectedRevision', 'expectedItemRevision', 'expectedScopeRevision', 'expectedEvidenceRevision']
  if (Object.keys(value).some(key => ![...revisions, 'modelVersion', 'reach', 'sourceReference', 'methodology'].includes(key)) || revisions.some(key => !positive(value[key])) || !productModelVersion(value.modelVersion) || typeof value.reach !== 'number' || !Number.isSafeInteger(value.reach) || value.reach < 0 || value.reach > 1000000000 || !text(value.sourceReference) || !text(value.methodology)) return null
  return { item_biz_id: itemId, model_version: value.modelVersion, expected_revision: value.expectedRevision, expected_item_revision: value.expectedItemRevision, expected_scope_revision: value.expectedScopeRevision, expected_evidence_revision: value.expectedEvidenceRevision, reach: value.reach, source_reference: value.sourceReference, methodology: value.methodology }
}

export function productReachReadInput(query: Record<string, unknown>, itemId: string, observationId?: string) {
  if (!uuid(itemId)) return null
  if (observationId !== undefined) return uuid(observationId) && Object.keys(query).length === 0 ? { item_biz_id: itemId, biz_id: observationId } : null
  const page = productModelPageInput(query)
  return page ? { item_biz_id: itemId, ...page } : null
}
