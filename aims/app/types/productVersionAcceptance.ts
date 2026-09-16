export interface VersionExecutionItem {
  item_key: string
  title: string
  parent_id: number | null
  version_id: number | null
  feature_id: number | null
  id: number
  project_id: number
  status: string
  weight: number
  priority: string
  severity: string | null
  content_hash: string
}

export interface VersionExecutionSnapshot {
  target_count?: number
  open_defect_count?: number
  restricted_item_count?: number
  targets: VersionExecutionItem[]
  open_defects: VersionExecutionItem[]
  total_weight: number
  completed_weight: number
  no_execution_plan: boolean
  defect_coverage: string
  content_hash: string
}

export interface ProductVersionAcceptancePreview {
  review_hash: string
  version: {
    business_owner_uid?: string | null
    id: number
    product_code: string
    version_code: string
    name: string | null
    status: string
    scope_revision: number
    revision: number
  }
  workspace_revision: number
  scope_count: number
  unresolved_scope_count: number
  delivered_scope_count: number
  deferred_scope_count: number
  product_status: string
  execution: VersionExecutionSnapshot
}

export interface AcceptanceCheck {
  code: string
  evidence: string
}

export interface AcceptanceException {
  code: string
  reason: string
  responsibleUid: string
  impact: string
}

export interface AcceptanceInput {
  expectedRevision: number
  expectedVersionRevision: number
  expectedScopeRevision: number
  expectedReviewHash: string
  checks: AcceptanceCheck[]
  exceptions: AcceptanceException[]
}

export interface VersionAcceptanceRecord {
  id: number
  version_id: number
  scope_revision: number
  accepted_by: string
  accepted_at: string
}
export interface VersionAcceptancePage {
  items: VersionAcceptanceRecord[]
  total: number
  page: number
  pageSize: number
  current_scope_revision: number
}
export interface VersionAcceptanceDetail extends VersionAcceptanceRecord {
  checks: AcceptanceCheck[]
  exceptions: { code: string, reason: string, responsible_uid: string, impact: string }[]
  current_scope_revision: number
}
