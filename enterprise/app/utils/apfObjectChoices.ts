export const apfObjectSpecs = {
  'customers': { path: '/altoc/api/v1/customers', resource: 'customer', key: 'id', name: 'name', code: 'code', label: '客户' },
  'quotes': { path: '/altoc/api/v1/quotes', resource: 'quotation', key: 'id', name: 'quotation_no', code: 'code', label: '报价' },
  'contracts': { path: '/altoc/api/v1/contracts', resource: 'contract', key: 'id', name: 'name', code: 'code', label: '合同' },
  'opportunities': { path: '/altoc/api/v1/opportunities', resource: 'opportunity', key: 'id', name: 'name', code: 'code', label: '商机' },
  'service-agreements': { path: '/altoc/api/v1/service-agreements', resource: 'contract', key: 'id', name: 'name', code: 'code', label: '服务协议' },
  'positions': { path: '/enterprise/api/apf/people/positions/list', resource: 'positions', key: 'position_code', name: 'position_name', code: 'position_code', label: '岗位' },
  'ranks': { path: '/enterprise/api/apf/people/ranks', resource: 'ranks', key: 'rank_code', name: 'rank_name', code: 'rank_code', label: '职级' },
  'assignments': { path: '/enterprise/api/apf/people/assignments', resource: 'assignments', key: 'assignment_code', name: 'display_name', code: 'assignment_code', label: '任职' },
  'projects': { path: '/aims/api/v1/projects', resource: '', key: 'project_code', name: 'project_name', code: 'project_code', label: '项目' },
  'contacts': { path: '/altoc/api/v1/customers', resource: 'customer', key: 'id', name: 'name', code: 'code', label: '联系人' },
  'contract-lines': { path: '/altoc/api/v1/contracts', resource: 'contract', key: 'id', name: 'name', code: 'code', label: '合同行' }
} as const
export type APFObjectKind = keyof typeof apfObjectSpecs
export type APFChoiceRow = Record<string, unknown>
export function apfChoicePage(reply: unknown, kind: APFObjectKind): { rows: APFChoiceRow[], total: number } {
  const r = reply as { data?: unknown, total?: number }
  const data = r?.data as { data?: unknown, items?: unknown, contacts?: unknown, total?: number } | undefined
  const raw = kind === 'contacts' ? data?.contacts : Array.isArray(data) ? data : data?.items || data?.data
  if (!Array.isArray(raw)) throw new Error('Object list unavailable')
  const total = kind === 'contacts' ? raw.length : Number((Array.isArray(data) ? r.total : data?.total) ?? raw.length)
  if (!Number.isSafeInteger(total) || total < raw.length) throw new Error('Object list total unavailable')
  return { rows: raw, total }
}
export function apfChoiceOptions(rows: APFChoiceRow[], kind: APFObjectKind) {
  const spec = apfObjectSpecs[kind]
  return rows.map(row => ({ value: String(row[spec.key]), label: `${String(row[spec.name] || row.name || spec.label)}（${String(row[spec.code] || row.code || '')}）`, disabled: kind === 'quotes' && !['approved', 'accepted'].includes(String(row.status)), row }))
}
