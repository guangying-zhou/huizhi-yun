export interface ProductCatalogItem {
  product_code: string
  product_name: string
  product_line: string
  product_line_label: string | null
  product_line_sort_order: number | null
  source_status: string
  source_updated_at: string
  business_owner_uid: string | null
  technical_owner_uid: string | null
  onboardable: boolean
}
export interface ProductCatalogPage {
  items: ProductCatalogItem[]
  total: number
  page: number
  pageSize: number
  watermark: string
  nextPage: number | null
}

export function productCatalogPage(raw: unknown): ProductCatalogPage | null {
  if (!raw || typeof raw !== 'object') return null
  const page = raw as ProductCatalogPage
  if (!Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < 0
    || !Number.isSafeInteger(page.page) || page.page < 1 || !Number.isSafeInteger(page.pageSize) || page.pageSize < 1 || page.pageSize > 100
    || typeof page.watermark !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[1-9]\d*$/.test(page.watermark)
    || page.items.length !== Math.max(0, Math.min(page.pageSize, page.total - (page.page - 1) * page.pageSize))
    || page.nextPage !== (page.page * page.pageSize < page.total ? page.page + 1 : null)) return null
  const seen = new Set<string>()
  for (const row of page.items) {
    if (!row || typeof row.product_code !== 'string' || !row.product_code || [...row.product_code].length > 64
      || seen.has(row.product_code) || typeof row.product_name !== 'string' || !row.product_name || [...row.product_name].length > 255
      || typeof row.product_line !== 'string' || [...row.product_line].length > 64 || typeof row.source_status !== 'string'
      || typeof row.onboardable !== 'boolean' || typeof row.source_updated_at !== 'string' || !Number.isFinite(Date.parse(row.source_updated_at))
      || (row.product_line_label !== null && typeof row.product_line_label !== 'string')
      || (row.product_line_sort_order !== null && !Number.isSafeInteger(row.product_line_sort_order))
      || (row.business_owner_uid !== null && typeof row.business_owner_uid !== 'string')
      || (row.technical_owner_uid !== null && typeof row.technical_owner_uid !== 'string')) return null
    seen.add(row.product_code)
  }
  return page
}
