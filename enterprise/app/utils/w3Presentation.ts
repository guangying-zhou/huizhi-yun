export type W3Record = Record<string, unknown>
export const w3ContractCategories: Record<string, string> = { purchase: '采购', software_sales: '软件产品销售', software_development: '软件开发服务', tech_data_service: '技术与数据服务', system_maintenance: '系统维护服务', saas: 'SaaS 销售', platform_operation: '平台运营服务', hardware_integration: '硬件与系统集成', other: '其他' }
export const w3SnapshotLabels: Record<string, string> = {
  contract_count_subtree: '合同份数（含下属）', contract_amount_subtree: '合同额（含下属）', contract_count_direct: '合同份数（本客户）', contract_amount_direct: '合同额（本客户）', contract_count_3y: '近三年合同份数', contract_amount_3y: '近三年合同额', contract_count_1y: '近一年合同份数', contract_amount_1y: '近一年合同额', contract_count_ytd: '当年合同份数', contract_amount_ytd: '当年合同额', receivable_contract_count: '应收合同份数', receivable_amount_subtree: '应收（含下属）', receivable_amount_direct: '应收（本客户）', remaining_uninvoiced_amount: '剩余未开票额', remaining_settlement_amount: '剩余应收 / 应付'
}
export function w3SnapshotRows(snapshot: W3Record, current: W3Record = {}) {
  return Object.keys(w3SnapshotLabels).filter(key => key in snapshot).map(key => ({ key, label: w3SnapshotLabels[key], value: snapshot[key] ?? null, current: current[key] ?? null, tracked: Object.hasOwn(current, key), different: snapshot[key] !== null && current[key] !== null && current[key] !== undefined && String(snapshot[key]) !== String(current[key]) }))
}
export const contactStarLabels = ['2 星', '3 星', '3.5 星', '4 星', '4.5 星', '5 星']
export function w3StarLabel(value: unknown) {
  return value === null || value === undefined ? '—' : contactStarLabels[Number(value) - 1] || '—'
}
export function w3OwnerLabel(uid: unknown, displayName: string) {
  return String(uid).startsWith('system:') ? '待匹配' : displayName
}
export function historicalContract(row: W3Record | null) {
  return row?.origin_type === 'historical_import'
}
// Compare decimals exactly, without binary floating point or lossy rounding.
export function effectiveAmountExceedsTotal(row: W3Record | null) {
  const decimal = (value: unknown) => typeof value === 'string' && /^\d+\.\d{2}$/.test(value) ? BigInt(value.replace('.', '')) : null
  const effective = decimal(row?.effective_amount), total = decimal(row?.amount_tax_inclusive)
  return effective !== null && total !== null && effective > total
}
