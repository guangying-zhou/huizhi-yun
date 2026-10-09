// Synthetic records only. No service, database, credentials or production writes.
export const receipt = { id: 1, code: 'RC-SYNTHETIC-001', customer_code: 'CU-SYNTHETIC', customer_name: '合成客户甲', contract_code: 'CT-SYNTHETIC', billing_schedule_code: 'BS-SYNTHETIC-001', currency_code: 'CNY', received_amount: '100000.00', unreconciled_amount: '100000.00', row_version: 1, status: 'confirmed', confirmed_by: 'cashier', reconciliation_responsible_uid: 'reviewer', received_at: '2026-10-07' }
export const plan = { id: 1, code: 'BS-SYNTHETIC-001', name: '合成合同首期款', contract_id: 1, contract_code: 'CT-SYNTHETIC', contract_name: '合成服务合同甲', customer_id: 1, amount: '60000.00', received_amount: '0.00', unreceived_amount: '60000.00', currency_code: 'CNY', row_version: 1, status: 'pending', due_date: '2026-10-15', aging_bucket: 'not_due', financial_ready: true, collection_installed: true, followups: [], followup_total: 0 }
export const candidates = [{ ...plan, outstanding_amount: '60000.00' }, { ...plan, id: 2, code: 'BS-SYNTHETIC-002', name: '合成合同验收款', outstanding_amount: '40000.00' }]
export const permissions = { altoc: { receivable: ['view', 'assign', 'followup', 'set-due-date'], customer: ['view'], contract: ['view'] }, finance: { receipts: ['view', 'confirm', 'edit'], invoices: ['view', 'edit', 'issue'], reconciliation: ['view', 'confirm'], historical_finance: ['view'], bank_accounts: ['view'] } }
export function settlementResponse(url, method, body, state) {
  const path = url.pathname
  const page = rows => ({ code: 0, data: rows, total: rows.length, page: Number(url.searchParams.get('page') || 1), pageSize: 20 })
  if (path.endsWith('/auth/me')) return { authenticated: true, provider: 'console_oidc', tenant: 'FIXTURE', uid: state.actor, subjectCode: state.actor, policyVersion: 'fixture-v1', deployment: 'fixture' }
  if (path.endsWith('/auth/permissions')) return { code: 0, data: { appCode: url.searchParams.get('app'), uid: state.actor, roles: [], availableRoles: [], activeRoleCode: '', resources: permissions[url.searchParams.get('app')] || {}, actionPolicies: {} } }
  if (path === '/altoc/api/v1/receivables') return { code: 0, data: { items: [plan], total: 1, totals: [], collection_installed: true } }
  if (path === '/altoc/api/v1/receivables/1') return { code: 0, data: plan }
  if (path === '/altoc/api/v1/customers/1') return { code: 0, data: { id: 1, code: receipt.customer_code, name: receipt.customer_name } }
  if (path === '/altoc/api/v1/contracts') return { code: 0, data: { items: [{ id: 1, code: receipt.contract_code, name: '合成服务合同甲' }], total: 1 } }
  if (path.endsWith('/billing-schedules')) return { code: 0, data: { items: candidates.map(row => ({ ...row, direction: 'receivable' })), total: 2 } }
  if (path === '/finance/api/v1/receipts' && method === 'POST') {
    state.receipt = { ...receipt, code: 'RC-SYNTHETIC-NEW', status: 'draft', confirmed_by: '', ...Object.fromEntries(Object.entries(body).map(([k, v]) => [k.replace(/[A-Z]/g, c => '_' + c.toLowerCase()), v])) }
    return { code: 0, data: state.receipt }
  }
  if (path === '/finance/api/v1/receipts') return page([state.receipt])
  if (/\/receipts\/[^/]+\/confirm$/.test(path)) {
    state.receipt.status = 'confirmed'
    state.receipt.confirmed_by = state.actor
    return { code: 0, data: state.receipt }
  }
  if (path.endsWith('/allocation-candidates')) return { code: 0, data: { items: candidates, total: 2 } }
  if (path.endsWith('/allocate') && method === 'POST') {
    state.receipt.unreconciled_amount = '0.00'
    state.receipt.status = 'reconciled'
    return { code: 0, data: { code: 'BATCH-SYNTHETIC' } }
  }
  if (/\/receipts\/[^/]+$/.test(path)) return { code: 0, data: state.receipt }
  if (path === '/finance/api/v1/invoice-requests' && method === 'POST') {
    state.invoice = { ...receipt, code: 'IR-SYNTHETIC-NEW', requested_by: state.actor, requested_amount: body.requestedAmount, status: 'draft' }
    return { code: 0, data: state.invoice }
  }
  if (path === '/finance/api/v1/invoice-requests/IR-SYNTHETIC-NEW') return { code: 0, data: state.invoice }
  if (path === '/finance/api/v1/invoice-requests') return page([{ ...receipt, code: 'IR-SYNTHETIC', requested_by: 'sales', requested_amount: '100000.00', status: 'approved' }])
  if (/\/invoice-requests\/[^/]+$/.test(path)) return { code: 0, data: { ...receipt, code: 'IR-SYNTHETIC', requested_by: 'sales', requested_amount: '100000.00', status: 'approved' } }
  if (path === '/finance/api/v1/invoices') return page([])
  return undefined
}
