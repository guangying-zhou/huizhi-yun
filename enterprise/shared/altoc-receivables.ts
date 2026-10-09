export const receivableOperations = {
  'receivables-page': ['view', 'page'],
  'receivables-detail': ['view', 'detail'],
  'receivables-aging-summary': ['view', 'aging-summary'],
  'receivables-set-collection-owner': ['assign', 'set-collection-owner'],
  'receivables-set-due-date': ['set-due-date', 'set-due-date'],
  'collection-followup-create': ['followup', 'followup-create']
} as const
export type ReceivableOperation = keyof typeof receivableOperations
export const receivableRowFields = ['id', 'code', 'contract_id', 'contract_code', 'contract_name', 'customer_id', 'name', 'amount', 'currency_code', 'due_date', 'status', 'received_amount', 'unreceived_amount', 'owner_uid', 'collection_responsible_uid', 'collection_due_at', 'row_version', 'aging_bucket', 'origin_type', 'financial_ready', 'collection_installed']
export const agingLabels: Record<string, string> = { 'not_due': '未到期', '1_30': '逾期 1–30 天', '31_60': '逾期 31–60 天', '61_90': '逾期 61–90 天', '91_180': '逾期 91–180 天', 'over_180': '逾期 180 天以上', 'no_due_date': '无到期日' }
export const receivableFilters = ['search', 'status', 'customerId', 'contractId', 'collectionResponsibleUid', 'currencyCode', 'agingBucket', 'queryDate', 'legalEntityCode']

// Only known event fields are shown; never render raw stored JSON.
export function receivableEventChanges(row: Record<string, unknown>): string[] {
  const decode = (value: unknown): Record<string, unknown> => {
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch { return {} }
  }
  const before = decode(row.before_json), after = decode(row.after_json)
  const labels: Record<string, string> = { due_date: '到期日', collection_responsible_uid: '催收负责人', collection_due_at: '下次跟进' }
  return Object.entries(labels).filter(([key]) => Object.hasOwn(after, key)).map(([key, label]) => `${label}：${before[key] || '未设置'} → ${after[key] || '未设置'}`)
}

export const receivableOptionalColumns = ['contract_name', 'amount', 'received_amount', 'due_date', 'aging_bucket', 'collection_responsible_uid', 'collection_due_at', 'status']
export function receivableColumnPreference(input: unknown): string[] {
  if (!Array.isArray(input)) return [...receivableOptionalColumns]
  return receivableOptionalColumns.filter(key => input.includes(key))
}
