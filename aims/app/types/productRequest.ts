export interface ProductRequestRecord {
  biz_id: string
  product_code: string
  title: string
  problem_statement: string | null
  source_type: string
  urgency_level: string
  decision_status: string
  decision_reason: string | null
  decided_by: string | null
  decided_at: string | null
  revision: number
  /** 可为空：需求不必先归入产品模块。 */
  component_id?: number | null
  component_name?: string | null
  /** 需求接口返回的版本安排摘要，省略时表示尚无轻量安排。 */
  scheduled_version_id?: number | null
  scheduled_version_code?: string | null
  scheduled_plan_status?: 'confirmed' | 'draft_or_stale' | null
}
