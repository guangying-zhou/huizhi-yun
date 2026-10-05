export interface ProductObservation {
  id: number
  metric_snapshot: { name: string, unit: string, direction: string, measurement_method: string, baseline_value: string | null, target_value: string | null }
  observed_value: string | null
  observed_at: string
  evidence: { summary: string, source: string, reason: string }
  conclusion: string
  correction_of_id: number | null
  corrected_by_id: number | null
  recorded_by: string
  recorded_at: string
}
