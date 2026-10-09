import type { W3Record } from './w3Presentation'

export const customerTabs = [
  { label: '基本信息', value: 'basic' }, { label: '联系人', value: 'contacts' },
  { label: '合同', value: 'contracts' }, { label: '应收', value: 'receivables' }, { label: '来源与审计', value: 'source' }, { label: '时间线', value: 'timeline' }
]
export const customerSortOptions = [{ label: '最近更新', value: 'updated_desc' }, { label: '更新时间升序', value: 'updated_asc' }, { label: '编号顺序', value: 'id_asc' }]
export function customerListState(query: Record<string, unknown>) {
  const text = (key: string, max = 64) => typeof query[key] === 'string' ? String(query[key]).trim().slice(0, max) : ''
  const date = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(text(key)) ? text(key) : ''
  return { page: /^[1-9]\d{0,5}$/.test(text('page')) ? Number(text('page')) : 1, search: text('search', 200), status: text('status') || 'all', rootsOnly: query.rootsOnly === 'true', ownerUnassigned: query.ownerUnassigned === 'true', ownerUid: text('ownerUid'), industryCode: text('industryCode'), regionCode: text('regionCode'), updatedDateFrom: date('updatedDateFrom'), updatedDateTo: date('updatedDateTo'), customerSort: customerSortOptions.some(o => o.value === query.customerSort) ? String(query.customerSort) : 'updated_desc' }
}
export function customerListQuery(state: ReturnType<typeof customerListState>) {
  return { page: state.page, pageSize: 20, customerSort: state.customerSort, ...(state.search ? { search: state.search } : {}), ...(state.status !== 'all' ? { status: state.status } : {}), ...(state.rootsOnly ? { rootsOnly: true } : {}), ...(state.ownerUnassigned ? { ownerUnassigned: true } : {}), ...Object.fromEntries(['ownerUid', 'industryCode', 'regionCode', 'updatedDateFrom', 'updatedDateTo'].filter(key => state[key as keyof typeof state]).map(key => [key, state[key as keyof typeof state]])) }
}
export function customerTab(value: unknown) {
  return customerTabs.some(tab => tab.value === value) ? String(value) : 'basic'
}
export function customerTimeline(customer: W3Record) {
  const source = customer.source_info as W3Record | undefined
  return [{ label: '当前系统记录创建', at: customer.created_at }, { label: '当前系统记录最近更新', at: customer.updated_at }, { label: '迁入记录', at: source?.importedAt }].filter(event => event.at != null && event.at !== '')
}
export function customerStatusColor(status: unknown): 'success' | 'warning' | 'neutral' {
  return status === 'active' || status === 'approved' ? 'success' : status === 'approval_pending' ? 'warning' : 'neutral'
}
