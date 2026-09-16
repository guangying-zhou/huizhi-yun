export interface ProductTreeItem {
  product_code: string
  biz_id: string
  status: 'active' | 'archived' | 'not_enabled'
  product_name: string | null
  product_line: string | null
  product_line_label: string | null
  management_product_code: string | null
  component_id: number | null
}
export interface ProductLineGroup {
  line_code: string
  label: string
  total: number
  management_product_code: string | null
  status: 'active' | 'archived' | null
  can_unify: boolean
}
export interface ProductTreePage {
  items: ProductTreeItem[]
  groups?: ProductLineGroup[]
  total: number
  catalog_generation: string | null
  catalog_updated_at: string | null
}
