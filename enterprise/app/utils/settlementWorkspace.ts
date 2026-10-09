export type SettlementTarget = { kind: 'receivable' | 'receipts' | 'invoice-requests' | 'invoices' | 'continuation' | 'adjustments', code: string, action: '' | 'new' | 'edit' | 'issue' | 'assign-issuance' | 'classify' | 'allocate' }

/** Only existing business routes may open a local panel. This is never an authorization source. */
export function settlementTarget(path: string): SettlementTarget | null {
  const match = /^(\/altoc\/payments|\/finance\/(?:receipts|invoices\/requests|invoices|historical-finance|receivable-adjustments))(?:\/([A-Za-z0-9_-]+))?(?:\/(edit|issue|assign-issuance|classify|allocate))?\/?$/.exec(path)
  if (!match) return null
  const kinds: Record<string, SettlementTarget['kind']> = { '/altoc/payments': 'receivable', '/finance/receipts': 'receipts', '/finance/invoices/requests': 'invoice-requests', '/finance/invoices': 'invoices', '/finance/historical-finance': 'continuation', '/finance/receivable-adjustments': 'adjustments' }
  const kind = kinds[match[1]!]!
  const code = match[2] === 'new' ? '' : match[2] || ''
  const action = (match[2] === 'new' ? 'new' : match[3] || '') as SettlementTarget['action']
  const actions = kind === 'receipts' ? ['', 'new', 'edit', 'classify', 'allocate'] : kind === 'invoice-requests' ? ['', 'new', 'edit', 'issue', 'assign-issuance'] : ['']
  if (!actions.includes(action) || (action && action !== 'new' && !code) || (kind === 'receivable' && !/^\d+$/.test(code))) return null
  return { kind, code, action }
}

export function settlementContext(row: Record<string, unknown>) {
  // IDs and codes are distinct namespaces. Do not guess a customer code from an ID.
  return Object.fromEntries(['customer_code', 'customer_name', 'contract_code', 'billing_schedule_code', 'currency_code'].flatMap(key => typeof row[key] === 'string' && row[key] ? [[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), row[key] as string]] : []))
}
