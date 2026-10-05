export function productListInput(raw: Record<string, unknown>) {
  if (Object.keys(raw).some(key => !['page', 'pageSize', 'keyword', 'productLine', 'status', 'tree', 'childLine'].includes(key)) || Object.values(raw).some(value => typeof value !== 'string')) return null
  const page = raw.page ?? '1'
  const size = raw.pageSize ?? '20'
  if (!/^[1-9]\d*$/.test(String(page)) || Number(page) > 1000000 || !/^[1-9]\d*$/.test(String(size)) || Number(size) > 100) return null
  if ([...String(raw.keyword || '')].length > 200 || [...String(raw.productLine || '')].length > 64 || (raw.status && !['active', 'archived', 'not_enabled'].includes(String(raw.status)))) return null
  if ((raw.tree !== undefined && raw.tree !== 'true') || (raw.childLine !== undefined && (raw.tree !== 'true' || [...String(raw.childLine)].length > 64))) return null
  return { ...(raw.tree === 'true' ? { tree: true, ...(raw.childLine !== undefined ? { child_line: String(raw.childLine) } : {}) } : {}), page: Number(page), page_size: Number(size), keyword: String(raw.keyword || ''), product_line: String(raw.productLine || ''), status: String(raw.status || '') }
}
