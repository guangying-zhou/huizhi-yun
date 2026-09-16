export interface ProductPlanningCycle {
  biz_id: string
  product_code: string
  title: string
  starts_on: string
  ends_on: string
  goal_summary: string
  status: 'draft' | 'open' | 'closed'
  budget: Record<'total_person_days' | 'reserve_person_days' | 'reliability_person_days' | 'usability_person_days' | 'growth_person_days', string | null> | null
  review_interval_days: number
  next_review_at: string | null
  revision: number
  queue_revision: number
  model_version: string
  model_snapshot?: unknown
  metric_definition: { name: string, unit: string, direction: string, measurement_method: string } | null
  baseline_value: string | null
  target_value: string | null
}
