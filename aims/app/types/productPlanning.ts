export interface ProductPlanningDetail {
  biz_id: string
  product_code: string
  title: string
  scope_summary: string
  investment_category: string
  urgency_level: string
  lifecycle: string
  requires_impact_note: boolean
  deadline: string | null
  scope_revision: number
  evidence_revision: number
  revision: number
  workspace_revision: number
  requests: { biz_id: string, revision: number }[]
}
