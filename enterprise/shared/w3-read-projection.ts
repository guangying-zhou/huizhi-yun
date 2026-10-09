// Closed nested W3 projections. Never forward ledger JSON or evidence fields.
export const w3SnapshotFields: Record<'customer' | 'contract', readonly string[]> = {
  customer: ['snapshot_at', 'source_note', 'batch_code', 'contract_count_subtree', 'contract_amount_subtree', 'contract_count_direct', 'contract_amount_direct', 'contract_count_3y', 'contract_amount_3y', 'contract_count_1y', 'contract_amount_1y', 'contract_count_ytd', 'contract_amount_ytd', 'receivable_contract_count', 'receivable_amount_subtree', 'receivable_amount_direct'],
  contract: ['snapshot_at', 'source_note', 'batch_code', 'remaining_uninvoiced_amount', 'remaining_settlement_amount', 'settlement_direction']
}
export const w3SourceFields = ['system', 'table', 'pk', 'batchCode', 'importedAt'] as const
