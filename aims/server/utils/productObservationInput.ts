import { productPlanningCyclePageInput, productPlanningCycleTransitionInput } from './productPlanningCycleInput.ts'

const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.isWellFormed() && !v.includes('\0') && [...v].length <= 2000
export function productObservationPageInput(raw: Record<string, unknown>, cycleId: string) {
  if (Object.keys(raw).some(k => !['page', 'pageSize'].includes(k))) return null
  const identity = productPlanningCycleTransitionInput({ expectedRevision: 1, expectedCycleRevision: 1, reason: 'read' }, cycleId)
  const page = productPlanningCyclePageInput(raw)
  if (!identity || !page) return null
  return { cycle_biz_id: cycleId, page: page.page, page_size: page.page_size }
}
export function productObservationCreateInput(raw: unknown, cycleId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(k => !['expectedRevision', 'expectedCycleRevision', 'reason', 'valueMode', 'observedValue', 'observedAt', 'evidenceSummary', 'evidenceSource', 'conclusion', 'correctionOfId'].includes(k))) return null
  const transition = productPlanningCycleTransitionInput({ expectedRevision: v.expectedRevision, expectedCycleRevision: v.expectedCycleRevision, reason: v.reason }, cycleId)
  if (!transition || !['known', 'unknown'].includes(String(v.valueMode))) return null
  if (v.valueMode === 'known' ? typeof v.observedValue !== 'string' || !/^-?\d{1,14}(?:\.\d{1,6})?$/.test(v.observedValue) : v.observedValue !== null) return null
  if (!text(v.evidenceSummary) || !text(v.evidenceSource) || !text(v.conclusion)) return null
  if (typeof v.observedAt !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v.observedAt) || !Number.isFinite(Date.parse(v.observedAt))) return null
  // Reject normalized impossible dates such as February 30 before forwarding.
  const day = v.observedAt.slice(0, 10)
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return null
  if (v.correctionOfId !== null && (!Number.isSafeInteger(v.correctionOfId) || Number(v.correctionOfId) < 1)) return null
  return { ...transition, value_mode: v.valueMode as 'known' | 'unknown', observed_value: v.observedValue as string | null, observed_at: v.observedAt, evidence_summary: v.evidenceSummary, evidence_source: v.evidenceSource, conclusion: v.conclusion, correction_of_id: v.correctionOfId as number | null }
}

export function productObservationDetailInput(raw: Record<string, unknown>, cycleId: string, observationId: string) {
  if (Object.keys(raw).length || !/^[1-9]\d*$/.test(observationId) || !Number.isSafeInteger(Number(observationId)) || !productObservationPageInput({}, cycleId)) return null
  return { cycle_biz_id: cycleId, observation_id: Number(observationId) }
}
