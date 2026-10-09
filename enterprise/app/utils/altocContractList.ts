import { w3ContractCategories, historicalContract, type W3Record } from './w3Presentation.ts'

export type ContractListState = { page: number, pageSize: number, status: string, customerId: string, ownerUid: string, direction: string, contractType: string, amountMin: string, amountMax: string, search: string, origin: string, category: string, ownerUnassigned: boolean, signedDateFrom: string, signedDateTo: string, view: string }
export const contractListViews = [{ label: '全部合同', value: 'all' }, { label: '历史合同', value: 'historical' }, { label: '负责人待匹配', value: 'unassigned' }, { label: '本年签约', value: 'this-year' }]
export function validContractCalendarDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1000-01-01' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}
export function contractListState(query: Record<string, unknown>): ContractListState {
  const string = (key: string) => typeof query[key] === 'string' ? query[key] as string : ''
  const page = Number(string('page'))
  return { pageSize: [20, 50, 100].includes(Number(string('pageSize'))) ? Number(string('pageSize')) : 20, status: string('status'), customerId: /^[1-9][0-9]*$/.test(string('customerId')) ? string('customerId') : '', ownerUid: string('ownerUid'), direction: ['sales', 'purchase'].includes(string('direction')) ? string('direction') : '', contractType: string('contractType'), amountMin: string('amountMin'), amountMax: string('amountMax'), page: Number.isSafeInteger(page) && page > 0 && page <= 1_000_000 ? page : 1, search: string('search').slice(0, 200), origin: ['native', 'historical_import'].includes(string('origin')) ? string('origin') : 'all', category: Object.hasOwn(w3ContractCategories, string('category')) ? string('category') : 'all', ownerUnassigned: string('ownerUnassigned') === 'true', signedDateFrom: validContractCalendarDate(string('signedDateFrom')) ? string('signedDateFrom') : '', signedDateTo: validContractCalendarDate(string('signedDateTo')) ? string('signedDateTo') : '', view: contractListViews.some(v => v.value === string('view')) ? string('view') : 'all' }
}
export function contractListQuery(state: ContractListState, year: number) {
  return { page: state.page, pageSize: state.pageSize, ...Object.fromEntries(['status', 'customerId', 'ownerUid', 'direction', 'contractType', 'amountMin', 'amountMax'].filter(key => state[key as keyof ContractListState]).map(key => [key, state[key as keyof ContractListState]])), ...(state.search.trim() ? { search: state.search.trim() } : {}), ...(state.origin !== 'all' ? { origin: state.origin } : {}), ...(state.category !== 'all' ? { category: state.category } : {}), ...(state.ownerUnassigned ? { ownerUnassigned: true } : {}), ...(state.view === 'this-year' ? { signedDateFrom: `${year}-01-01`, signedDateTo: `${year}-12-31` } : { ...(state.signedDateFrom ? { signedDateFrom: state.signedDateFrom } : {}), ...(state.signedDateTo ? { signedDateTo: state.signedDateTo } : {}) }) }
}
export function contractListAmount(row: W3Record) {
  return historicalContract(row) ? { value: row.signed_amount ?? null, label: '原签约额' } : { value: row.amount_tax_inclusive ?? null, label: '当前合同额' }
}
export function contractListDateLabel(row: W3Record) {
  return row.signed_date || (['draft', 'submitted', 'approved', 'rejected'].includes(String(row.status)) && !historicalContract(row) ? '未签约' : '未记录')
}

// Only closed view/column preferences; never store free text, dates or object data.
export const contractOptionalColumnKeys = ['contract_category', 'effective_amount', 'owner_uid', 'direction', 'effective_date', 'end_date']
export function contractListPreference(value: unknown) {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    columns: Array.isArray(input.columns) ? [...new Set(input.columns.filter((key): key is string => typeof key === 'string' && contractOptionalColumnKeys.includes(key)))] : ['contract_category', 'effective_amount', 'owner_uid'],
    expanded: input.expanded === true
  }
}

export function contractEffectiveAmount(row: W3Record) {
  const missing = row.effective_amount === null || row.effective_amount === undefined || row.effective_amount === ''
  return missing ? { ...contractListAmount(row), fallback: true } : { value: row.effective_amount, label: historicalContract(row) ? '原系统人工录入' : '有效合同额', fallback: false }
}
export function contractAmountRangeError(min: string, max: string) {
  const valid = (v: string) => /^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/.test(v)
  if ([min, max].some(v => v && !valid(v))) return '金额须为非负数，最多两位小数'
  const cents = (v: string) => BigInt(v.split('.')[0]!) * 100n + BigInt(((v.split('.')[1] || '') + '00').slice(0, 2))
  return min && max && cents(min) > cents(max) ? '最低金额不能高于最高金额' : ''
}
