import { productModelVersion } from './productModelInput'

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.isWellFormed() && !value.includes('\0') && [...value].length <= max
const weightedDimensions = ['strategic', 'user_value', 'business', 'risk', 'confidence', 'effort_person_days']
export function productAssessmentCreateInput(raw: unknown, cycleId: string, itemId: string) {
  return assessmentCreateInput(raw, cycleId, itemId, false)
}

export function productRICEAssessmentCreateInput(raw: unknown, cycleId: string, itemId: string) {
  return assessmentCreateInput(raw, cycleId, itemId, true)
}

function assessmentCreateInput(raw: unknown, cycleId: string, itemId: string, rice: boolean) {
  const dimensions = rice ? ['impact', 'confidence', 'effort_person_days'] : weightedDimensions
  if (!record(raw) || !uuid(cycleId) || !uuid(itemId)) return null
  const allowed = ['expectedRevision', 'expectedCycleRevision', 'expectedItemRevision', 'expectedScopeRevision', 'expectedEvidenceRevision', 'assessment', 'rationale', 'evidence', 'evidenceReferences', 'estimateConfirmed']
  if (Object.keys(raw).some(key => !allowed.includes(key))) return null
  for (const key of allowed.slice(0, 5)) if (!Number.isSafeInteger(raw[key]) || Number(raw[key]) < 1) return null
  const assessment = raw.assessment, rationale = raw.rationale, references = raw.evidenceReferences
  if (!record(assessment) || !record(rationale) || !record(references) || !Array.isArray(raw.evidence) || raw.evidence.length > 100 || typeof raw.estimateConfirmed !== 'boolean') return null
  if (Object.keys(assessment).some(key => ![...dimensions, 'model_version', 'effort_unit', ...(rice ? ['observation_biz_id'] : [])].includes(key)) || !productModelVersion(assessment.model_version) || assessment.effort_unit !== 'person_day') return null
  // Explicit null preserves unknown; absent dimensions cannot silently clear an evaluation.
  for (const key of dimensions) if (!Object.hasOwn(assessment, key)) return null
  if (rice) {
    if (typeof assessment.observation_biz_id !== 'string' || (assessment.observation_biz_id !== '' && !uuid(assessment.observation_biz_id))) return null
    if (assessment.impact !== null && (typeof assessment.impact !== 'string' || !['0.25', '0.50', '1.00', '2.00', '3.00'].includes(assessment.impact))) return null
  }
  for (const key of rice ? [] : dimensions.slice(0, 4)) if (assessment[key] !== null && (!Number.isInteger(assessment[key]) || Number(assessment[key]) < 0 || Number(assessment[key]) > 5)) return null
  if (assessment.confidence !== null && !['0.50', '0.80', '1.00'].includes(String(assessment.confidence))) return null
  if (assessment.confidence !== null && typeof assessment.confidence !== 'string') return null
  const effort = assessment.effort_person_days
  if (effort !== null) {
    if (typeof effort !== 'string' || !/^\d{1,7}(?:\.\d{1,2})?$/.test(effort)) return null
    const [whole = '', fraction = ''] = effort.split('.')
    const units = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
    if (units < 50 || units > 100000000 || !raw.estimateConfirmed) return null
  } else if (raw.estimateConfirmed) return null
  const keys = new Set<string>()
  for (const evidence of raw.evidence) {
    if (!record(evidence) || Object.keys(evidence).some(key => !['key', 'summary', 'observed_on', 'kind', 'polarity'].includes(key))) return null
    if (typeof evidence.key !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(evidence.key) || keys.has(evidence.key) || !text(evidence.summary, 2000)) return null
    if (typeof evidence.observed_on !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(evidence.observed_on)) return null
    const date = new Date(`${evidence.observed_on}T00:00:00.000Z`)
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== evidence.observed_on) return null
    if (typeof evidence.kind !== 'string' || typeof evidence.polarity !== 'string' || !['fact', 'hypothesis'].includes(evidence.kind) || !['supporting', 'opposing', 'neutral'].includes(evidence.polarity)) return null
    keys.add(evidence.key)
  }
  for (const [dimension, reason] of Object.entries(rationale)) if (!dimensions.includes(dimension) || !text(reason, 2000)) return null
  for (const [dimension, refs] of Object.entries(references)) {
    if (!dimensions.includes(dimension) || !Array.isArray(refs) || refs.length === 0 || refs.length > 100 || !text(rationale[dimension], 2000) || new Set(refs).size !== refs.length || refs.some(key => typeof key !== 'string' || !keys.has(key))) return null
  }
  for (const dimension of dimensions) {
    if ((assessment[dimension] !== null || Object.hasOwn(rationale, dimension)) && (!text(rationale[dimension], 2000) || !Array.isArray(references[dimension]) || references[dimension].length === 0)) return null
  }
  return { cycle_biz_id: cycleId, item_biz_id: itemId, expected_revision: Number(raw.expectedRevision), expected_cycle_revision: Number(raw.expectedCycleRevision), expected_item_revision: Number(raw.expectedItemRevision), expected_scope_revision: Number(raw.expectedScopeRevision), expected_evidence_revision: Number(raw.expectedEvidenceRevision), assessment, rationale, evidence: raw.evidence, evidence_references: references, estimate_confirmed: raw.estimateConfirmed }
}

export function productAssessmentPageInput(raw: Record<string, unknown>, cycleId: string, itemId: string) {
  if (!uuid(cycleId) || !uuid(itemId) || Object.keys(raw).some(key => !['page', 'pageSize'].includes(key))) return null
  const number = (value: unknown, fallback: number) => value === undefined ? fallback : typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN
  const page = number(raw.page, 1), pageSize = number(raw.pageSize, 20)
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) return null
  return { cycle_biz_id: cycleId, item_biz_id: itemId, page, page_size: pageSize }
}
