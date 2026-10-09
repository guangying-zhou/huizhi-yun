export type FinanceObjectKind = 'customers' | 'contracts' | 'billing-schedules' | 'bank-accounts' | 'legal-entities'
export type FinanceObjectRow = { id: number, code: string, name?: string, customer_name?: string, currency_code?: string, status?: string, direction?: string, account_name?: string, bank_name?: string, masked_account_number?: string, [key: string]: unknown }
export function financeBankAccountChoice(row: Record<string, unknown>) {
  const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
  const label = text(row.short_name) || text(row.shortName) || text(row.account_name) || text(row.accountName) || text(row.code)
  // Consume only the masked projection and expose at most its final four digits.
  const masked = text(row.account_no_masked) || text(row.masked_account_number)
  const tail = masked.match(/(\d{4})\D*$/)?.[1]
  const description = [text(row.bank_name), text(row.currency_code), tail ? `尾号${tail}` : '', text(row.code)].filter(Boolean).join(' · ')
  return { label, description }
}
export function financeBankAccountLabel(row: Record<string, unknown>) {
  const choice = financeBankAccountChoice(row)
  return choice.description ? `${choice.label}（${choice.description}）` : choice.label
}
export function financeObjectOptions(rows: FinanceObjectRow[], kind: FinanceObjectKind, accountValue: 'id' | 'code' = 'id') {
  return rows.map(row => ({
    value: kind === 'bank-accounts' && accountValue === 'id' ? String(row.id) : row.code,
    ...(kind === 'bank-accounts' ? financeBankAccountChoice(row) : { label: `${String(row.name || row.account_name || row.bank_name || row.code)} · ${row.code}${row.currency_code ? ` · ${row.currency_code}` : ''}`, description: undefined }),
    disabled: kind === 'bank-accounts' || kind === 'legal-entities' ? row.status !== 'active' : kind === 'billing-schedules' ? row.direction !== 'receivable' || ['cancelled', 'bad_debt', 'received'].includes(String(row.status)) : false,
    row
  }))
}
export function financeChoiceError(error: unknown) {
  const e = error as { statusCode?: number, status?: number, response?: { status?: number } }
  return (e.statusCode || e.status || e.response?.status) === 403 ? '没有查看此业务对象的权限，请联系管理员' : '列表加载失败，请重试'
}
export function financeChoicePage(result: unknown): { items: FinanceObjectRow[], total: number } {
  const response = result as { data?: FinanceObjectRow[] | { items?: FinanceObjectRow[], total?: number }, total?: number }
  const items = Array.isArray(response?.data) ? response.data : response?.data?.items
  const total = Array.isArray(response?.data) ? response.total : response?.data?.total
  if (!Array.isArray(items) || !Number.isSafeInteger(total) || Number(total) < items.length || items.some(row => !row || !Number.isSafeInteger(row.id) || typeof row.code !== 'string')) throw new Error('Invalid list response')
  return { items, total: Number(total) }
}
