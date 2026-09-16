export interface ProductMatrixAssessment {
  model_method?: 'weighted-value-effort' | 'rice'
  value_score: number | null
  effort_person_days: string | null
  confidence: string | null
  priority_score: string | null
  stale: boolean
}

export function validProductMatrixPoint(method: 'weighted-value-effort' | 'rice', assessment: ProductMatrixAssessment | null) {
  if (!assessment || assessment.stale !== false || assessment.model_method !== method || typeof assessment.priority_score !== 'string' || !/^\d+\.\d{8}$/.test(assessment.priority_score)) return false
  const score = Number(assessment.priority_score)
  if (!Number.isFinite(score) || score < 0 || BigInt(assessment.priority_score.replace('.', '')) > (method === 'rice' ? 600000000000000000n : 20000000000n)) return false
  if (typeof assessment.effort_person_days !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(assessment.effort_person_days) || Number(assessment.effort_person_days) < 0.5 || Number(assessment.effort_person_days) > 1000000 || !['0.50', '0.80', '1.00'].includes(assessment.confidence ?? '')) return false
  return method === 'rice' ? assessment.value_score === null : typeof assessment.value_score === 'number' && Number.isInteger(assessment.value_score) && assessment.value_score >= 0 && assessment.value_score <= 100
}

export function productMatrixY(value: number, maximum: number) {
  return 310 - value / Math.max(1, maximum) * 260
}
