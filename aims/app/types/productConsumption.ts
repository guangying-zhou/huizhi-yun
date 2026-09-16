export interface ProductConsumptionConfirmation {
  confirmation_id: string
  cycle_biz_id: string
  item_biz_id: string
  item_revision: number
  scope_revision: number
  spent_person_days: string
  confirmed_by: string
  confirmed_at: string
  reason: string
}
export interface ProductConsumptionView {
  cycle_biz_id: string
  item_biz_id: string
  workspace_revision: number
  cycle_revision: number
  queue_revision: number
  item_revision: number
  scope_revision: number
  lifecycle: string
  selection_status: string
  current: boolean
  pending: ProductConsumptionConfirmation | null
}
