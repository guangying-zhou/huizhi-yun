export type UiColor = 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'

export interface ApiResponse<T> {
  code: number
  message?: string
  data: T
}

export interface SummaryMetric {
  label: string
  value: string | number
  hint?: string
  color?: UiColor
}

export interface QuickLinkItem {
  label: string
  description: string
  to: string
  icon: string
}

export interface AssetListItem {
  id: number
  public_id?: string | null
  asset_code: string
  asset_name: string
  asset_category: string
  asset_subtype: string
  physical_item_type?: string | null
  asset_purpose: string
  ownership_type: string
  status: string
  project_code?: string | null
  owner_uid?: string | null
  user_uid?: string | null
  contract_code?: string | null
  environment_name?: string | null
  monthly_cost?: number | null
  expires_at?: string | null
}

export interface AssetDetail extends AssetListItem {
  dept_code: string
  customer_code?: string | null
  notes?: string | null
  tags?: string[]
  brand?: string | null
  model?: string | null
  config_detail?: string | null
  serial_number?: string | null
  qr_code?: string | null
  location?: string | null
  purchased_at?: string | null
  documents?: AssetDocument[]
  latest_events?: AssetEvent[]
}

export interface AssetEvent {
  id: number
  event_type: string
  operator_uid?: string | null
  occurred_at: string
  summary: string
}

export interface AssetDocument {
  id: number
  document_id: string
  document_type: string
  artifact_type?: string | null
  source_context?: Record<string, unknown> | string | null
  remark?: string | null
}

export interface AssetCategoryItem {
  id: number
  value: string
  label: string
  shortCode?: string
  description?: string
  enabled: boolean
  sortOrder: number
}

export interface AssetCategoryGroup {
  id: number
  scope: 'physical' | 'resource' | 'product' | 'ip' | 'digital'
  value: string
  label: string
  shortCode?: string
  description?: string
  enabled: boolean
  sortOrder: number
  items: AssetCategoryItem[]
}

export interface EnvironmentLinkedAsset {
  id: number
  asset_code: string
  asset_name: string
  asset_category: string
  asset_subtype: string
  relation_type: string
  status: string
  is_primary: boolean
}

export interface ProductLinkedAsset {
  id: number
  asset_code: string
  asset_name: string
  asset_category: string
  asset_subtype: string
  relation_type: string
  status: string
  is_primary: boolean
}

export interface ProductLinkedBase {
  id: number
  base_code: string
  base_name: string
  base_type: string
  status: string
}

export interface DeliveryLinkedProduct {
  id: number
  product_code: string
  product_name: string
  status: string
  relation_type: string
}

export interface DeliveryLinkedEnvironment {
  id: number
  environment_code: string
  environment_name: string
  environment_type: string
  status: string
  relation_type: string
  monthly_cost: number
}

export interface IpLinkedProduct {
  id: number
  product_code: string
  product_name: string
  status: string
}

export interface DigitalLinkedProduct {
  id: number
  product_code: string
  product_name: string
  status: string
}

export interface ProductLinkedProduct {
  id: number
  product_code: string
  product_name: string
  status: string
}

export interface ProductDeliveryInstance {
  id: number
  delivery_code: string
  delivery_name: string
  customer_code: string
  contract_code?: string | null
  project_code: string
  status: string
  relation_type: string
  go_live_at?: string | null
  accepted_at?: string | null
}

export interface EnvironmentItem {
  id: number
  environment_code: string
  environment_name: string
  environment_type: string
  status: string
  project_code: string
  customer_code?: string | null
  contract_code?: string | null
  owner_uid?: string | null
  maintainer_uid?: string | null
  topology_summary?: string | null
  notes?: string | null
  asset_count: number
  monthly_cost: number
  linked_assets?: EnvironmentLinkedAsset[]
}

export interface ProductAssetItem {
  id: number
  product_code: string
  product_name: string
  product_line: string
  customer_domain?: string | string[] | null
  business_domain: string
  product_level?: string | null
  asset_level?: string | null
  status: string
  build_stage?: string | null
  current_version?: string | null
  target_version?: string | null
  productization_value_level?: string | null
  supported_terminals?: string | string[] | null
  covered_legacy_systems?: string | string[] | null
  summary?: string | null
  built_at?: string | null
  business_owner_uid?: string | null
  technical_owner_uid?: string | null
  project_code?: string | null
  notes?: string | null
  asset_count: number
  base_count: number
  documents?: AssetDocument[]
  linked_assets?: ProductLinkedAsset[]
  linked_bases?: ProductLinkedBase[]
  delivery_instances?: ProductDeliveryInstance[]
}

export interface IpAssetItem {
  id: number
  ip_code: string
  ip_name: string
  ip_type: string
  registration_no?: string | null
  right_holder?: string | null
  apply_date?: string | null
  effective_date?: string | null
  expires_at?: string | null
  status: string
  owner_uid?: string | null
  notes?: string | null
  product_count: number
  documents?: AssetDocument[]
  linked_products?: IpLinkedProduct[]
}

export interface DigitalAssetItem {
  id: number
  digital_code: string
  digital_name: string
  digital_type: string
  storage_location?: string | null
  owner_uid?: string | null
  access_scope: string
  project_code?: string | null
  environment_id?: number | null
  environment_name?: string | null
  status: string
  notes?: string | null
  product_count: number
  documents?: AssetDocument[]
  linked_products?: DigitalLinkedProduct[]
}

export interface TechnologyBaseItem {
  id: number
  base_code: string
  base_name: string
  base_type: string
  status: string
  service_targets?: string | null
  owner_uid?: string | null
  technical_owner_uid?: string | null
  project_code?: string | null
  asset_level?: string | null
  notes?: string | null
  product_count: number
  related_products?: ProductLinkedProduct[]
}

export interface DeliveryItem {
  id: number
  delivery_code: string
  delivery_name: string
  customer_code: string
  contract_code?: string | null
  project_code: string
  status: string
  environment_count: number
  monthly_cost: number
  owner_uid?: string | null
  go_live_at?: string | null
  accepted_at?: string | null
  notes?: string | null
  linked_environments?: DeliveryLinkedEnvironment[]
  linked_products?: DeliveryLinkedProduct[]
  documents?: AssetDocument[]
}

export interface SupplierItem {
  id: number
  supplier_code: string
  supplier_name: string
  credit_code?: string | null
  supplier_type: string
  status: string
  contact_name?: string | null
  contact_phone?: string | null
  contact_email?: string | null
  invoice_info?: string | null
  notes?: string | null
}

export interface PurchaseOrderItem {
  id: number
  order_no: string
  purchase_type: string
  purpose_type: string
  project_code?: string | null
  customer_code?: string | null
  contract_code?: string | null
  environment_id?: number | null
  supplier_id?: number | null
  supplier_name?: string | null
  status: string
  budget_amount: number
  actual_amount?: number | null
  applicant_uid: string
  applicant_dept_code?: string
  reason?: string | null
  created_at: string
}

export interface PurchaseOrderLineItem {
  id: number
  line_no: number
  item_name: string
  asset_category: string
  asset_subtype: string
  specification?: string | null
  quantity: number
  unit?: string | null
  unit_price?: number | null
  total_price?: number | null
  effective_at?: string | null
  expires_at?: string | null
  target_type: string
  target_ref?: string | null
  remark?: string | null
}

export interface ReceiptItem {
  id: number
  receipt_no: string
  order_no: string
  receipt_type: string
  status: string
  operator_uid?: string | null
  processed_at?: string | null
}

export interface AssignmentItem {
  id: number
  assignment_no: string
  asset_code: string
  asset_name: string
  action_type: string
  target_type: string
  target_ref?: string | null
  status: string
  workflow_instance_id?: string | null
  effective_at?: string | null
}

export interface AlertItem {
  id: number
  alert_no: string
  alert_type: string
  severity: UiColor
  title: string
  status: string
  project_code?: string | null
  due_at?: string | null
  triggered_at: string
}

export interface ReportRow {
  label: string
  value: string
  hint?: string
}

export interface DashboardOverview {
  metrics: SummaryMetric[]
  quick_links: QuickLinkItem[]
  urgent_alerts: AlertItem[]
  expiring_assets: AssetListItem[]
}

export interface ListPayload<T> {
  summary: SummaryMetric[]
  total: number
  items: T[]
}
