export type AssessmentDimension = 'strategic' | 'user_value' | 'business' | 'risk' | 'confidence' | 'effort_person_days'
export interface ProductAssessment {
  id: number
  scope_revision: number
  evidence_revision: number
  model_version: string
  model_method?: 'weighted-value-effort' | 'rice'
  rice_impact?: string | null
  reach_observation_biz_id?: string | null
  model_snapshot: Record<string, unknown>
  strategic: number | null
  user_value: number | null
  business: number | null
  risk: number | null
  confidence: string | null
  effort_person_days: string | null
  effort_unit: string
  value_score: number | null
  priority_score: string | null
  evidence_snapshot: {
    reach_observation?: { biz_id: string, product_code: string, item_biz_id: string, model_version: string, reach: number, reach_unit: string, reach_starts_on: string, reach_ends_on: string, source_reference: string, methodology: string } | null
    manual_observations: { key: string, summary: string, observed_on: string, kind: 'fact' | 'hypothesis', polarity: 'supporting' | 'opposing' | 'neutral' }[]
    scope_summary: string
    investment_category: string
    requests: { biz_id: string, revision: number }[]
    recorded_by: string
  }
  rationale: { reasons: Partial<Record<AssessmentDimension | 'impact', string>>, evidence_references: Partial<Record<AssessmentDimension | 'impact', string[]>> }
  assessed_by: string
  estimated_by: string | null
  assessed_at: string
  is_current: boolean
  stale: boolean
}
