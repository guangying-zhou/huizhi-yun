export interface ProductVersionScope {
  is_public?: boolean
  successors?: { scope_id: number, version_id: number, version_code: string }[]
  deferred_from_scope_id?: number | null
  deferred_from_version_id?: number | null
  deferred_from_version_code?: string | null
  id: number
  version_id: number
  title: string
  description: string | null
  status: 'planned' | 'delivered' | 'deferred'
  change_type: 'new' | 'enhancement' | 'fix' | 'retirement' | null
  acceptance_criteria: string | null
  planning_item_biz_id: string | null
  product_feature_biz_id: string | null
  legacy_unscored: boolean
}
