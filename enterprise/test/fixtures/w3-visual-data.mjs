// Synthetic data only. These records have no relationship to any tenant or account.
export const source = { system: 'wizbiz', table: 'wb_fixture', pk: 'fixture-source-20261005-long-identifier', batchCode: 'W3-FIXTURE-20261005', importedAt: '2026-10-05T09:00:00Z' }
export const customer = { id: 1, code: 'CU-FIXTURE-0001', name: '合成客户集团科技服务有限公司（长名称视觉夹具）', short_name: '合成客户', owner_uid: 'fixture-user', status: 'active', childCount: 2, hasHiddenChildren: true, primary_contact_id: 1, row_version: 2, parent_customer_id: null, contact_name_text: '原系统自由文本联系人', customer_level_id: 1, customer_level_name: '战略客户', sort_no: 10, source_info: source, migration_snapshot: { snapshot_at: '2026-10-05', source_note: '合成迁移快照，非业务事实', contract_count_direct: 2, contract_count_subtree: 3, contract_amount_direct: '12345678.90', contract_amount_subtree: '23456789.00' } }
export const children = [2, 3].map(id => ({ ...customer, id, code: `CU-FIXTURE-000${id}`, name: `合成下属${id}数字化与信息技术服务有限公司（长名称夹具）`, parent_customer_id: 1, childCount: id === 2 ? 1 : 0, hasHiddenChildren: false, parent: { id: 1, name: customer.name } }))
export const contact = { id: 1, code: 'CO-FIXTURE-0001', name: '合成联系人长姓名', dept_name: '技术创新与数字化业务部门', job_title: '项目采购与信息安全负责人', mobile: '13000000000', status: 'active', star_level: 4, row_version: 2, source_info: source }
export const contract = { id: 1, code: 'CT-FIXTURE-0001', name: '合成历史合同：数字化平台建设与长期服务合同（长标题）', customer_id: 1, customer_name: customer.name, owner_uid: 'fixture-user', status: 'effective', row_version: 2, direction: 'sales', currency_code: 'CNY', origin_type: 'historical_import', amount_basis: 'header', signed_amount: '12345678.90', amount_tax_inclusive: '12345678.90', effective_amount: '11345678.90', contract_category: 'main', signed_at: '2026-09-20', legal_entity_code: 'LE-FIXTURE-01', legal_entity_name: '合成信息技术股份有限公司（集团总部）', receiving_bank_account_code: 'BA-FIXTURE-0001', receiving_bank_account_short_name: '基本户', source_info: source, migration_snapshot: { snapshot_at: '2026-10-05', remaining_uninvoiced_amount: '1000000.00', remaining_settlement_amount: '800000.00', source_note: '合成历史金额，仅用于视觉验证' }, lines: [], payment_terms: [], obligations: [], billing_schedules: [], project_links: [] }
export const childContract = { ...contract, id: 2, code: 'CT-FIXTURE-0002', name: '合成下级合同补充协议（长名称与多币种测试）', parent_contract_id: 1, contract_category: 'supplement', currency_code: 'USD', signed_amount: '5000.00', amount_tax_inclusive: '5000.00', effective_amount: '4500.00' }
export const entity = { id: 1, code: 'LE-FIXTURE-01', name: '合成信息技术股份有限公司（集团总部）', short_name: '合成总部', unified_social_credit_code: '91370000FIXTURE0001', entity_type: 'company', invoice_title: '合成信息技术股份有限公司', invoice_tax_no: '91370000FIXTURE0001', registered_address: '合成市合成路100号', sort_no: 1, status: 'active', row_version: 2, account_count: 2 }
export const account = { id: 1, code: 'BA-FIXTURE-0001', account_name: '合成信息技术股份有限公司集团总部银行基本存款账户（长标题）', short_name: '集团总部基本户', legal_entity_code: entity.code, legal_entity_name: entity.name, bank_name: '合成银行股份有限公司集团金融服务营业部', account_no_masked: '6222 **** **** 1234', account_type: 'bank', account_subtype: 'basic', bank_branch_code: 'FIXTURE0001', currency_code: 'CNY', owner_dept_code: 'FIXTURE-DEPT', status: 'active', row_version: 2, sort_no: 1, latest_balance_amount: '12345678.90', latest_balance_date: '2026-10-05', source_info: source }
export const snapshot = { id: 1, account_code: account.code, account_name: account.account_name, snapshot_date: '2026-10-05', balance_amount: '12345678.90', currency_code: 'CNY', source_type: 'manual', note: '合成登记，非真实资金', entry_count: 2, latest_tie_count: 1, distinct_amounts: 1 }
export const exceptions = [
  { id: 1, owning_domain: 'altoc', kind: 'contact_without_customer', target_key: 'source-contact-fixture', status: 'open', row_version: 1, source_table: 'wb_customer_contact', source_pk: 'fixture-1', detail: { name: '合成待归属联系人', mobile: '13000000000', deptName: '合成业务部门', jobTitle: '合成采购负责人' } },
  { id: 2, owning_domain: 'altoc', kind: 'effective_amount_exceeds_total', target_key: '1', status: 'open', row_version: 1, source_table: 'wb_contract', source_pk: 'fixture-2', detail: { totalAmount: '12345678.90', effectiveAmount: '23456789.00' } },
  { id: 3, owning_domain: 'finance', kind: 'balance_without_account', target_key: 'source-balance-fixture', status: 'open', row_version: 1, source_table: 'wb_account_balance', source_pk: 'fixture-3', detail: { balanceDate: '2026-10-05', entryCount: 2, latestAmounts: ['12345678.90', '12345670.00'] } },
  { id: 4, owning_domain: 'finance', kind: 'contract_balance_mismatch', target_key: 'CT-FIXTURE-0001', status: 'open', row_version: 1, detail: { recomputedAmount: '12345678.90', cachedAmount: '12345670.00', difference: '8.90' } },
  { id: 5, owning_domain: 'finance', kind: 'balance_latest_conflict', target_key: account.code, status: 'open', row_version: 1, detail: { balanceDate: '2026-10-05', latestAmounts: ['12345678.90', '12345670.00'] } }
]
const pageResult = (rows, url, extra = {}) => ({ data: rows, total: rows.length, page: Number(url.searchParams.get('page') || 1), pageSize: Number(url.searchParams.get('pageSize') || 20), ...extra })
export function visualResponse(url, method, body, permissions, navigationIds) {
  const p = url.pathname, q = url.searchParams
  if (p === '/api/rum') return { ok: true }
  if (p === '/aims/api/v1/projects') return { code: 0, data: { items: [{ id: 1, projectCode: 'PJ-FIXTURE', name: '合成项目', deptCode: 'FIXTURE-DEPT' }], total: 1 } }
  if (p.endsWith('/auth/me')) return { authenticated: true, provider: 'console_oidc', tenant: 'FIXTURE', uid: 'fixture-user', subjectCode: 'fixture-user', policyVersion: 'fixture-v1', deployment: 'fixture' }
  if (p.endsWith('/auth/permissions')) return { code: 0, data: { appCode: q.get('app'), uid: 'fixture-user', roles: [], availableRoles: [], activeRoleCode: '', resources: permissions, actionPolicies: {} } }
  if (p.endsWith('/navigation')) return { visibleIds: navigationIds, maxAgeMs: 300000 }
  if (p.endsWith('/org-brand')) return { code: 0, data: { shortName: '视觉夹具企业', displayName: '合成企业' } }
  if (p.endsWith('/notifications/summary')) return { code: 0, data: { totalCount: 0, unreadCount: 0, unreadByCategory: {}, latest: [] } }
  if (p.endsWith('/directory/users/batch')) return { code: 0, data: (body?.uids || ['fixture-user']).map(uid => ({ uid, realName: '合成用户', deptName: '合成部门', deptCode: 'FIXTURE-DEPT' })) }
  if (p.endsWith('/directory/departments')) return { code: 0, data: { tree: [{ code: 'FIXTURE-DEPT', name: '合成部门', children: [] }] } }
  if (p.endsWith('/directory/users')) return { code: 0, data: { items: [{ uid: 'fixture-user', realName: '合成用户', status: 'active', deptName: '合成部门' }], total: 1 } }
  if (p.endsWith('/directory/projects')) return { code: 0, data: [{ code: 'PJ-FIXTURE', name: '合成项目', deptCode: 'FIXTURE-DEPT' }] }
  if (p.endsWith('/user/applications')) return { code: 0, data: [] }
  if (p.includes('/migration/')) {
    if (p.endsWith('/identities')) return pageResult([{ source_user_id: 'employee:1', display_name: '合成原系统销售员工（长显示名）', directory_uid: 'fixture-user', match_status: 'candidate', source_status: 'active', open_owner_items: 2 }], url)
    if (q.has('exceptionId')) return pageResult([1, 2].map(id => ({ sourceEntryId: `fixture-entry-${id}`, balanceDate: '2026-10-05', amount: '12345678.90', recordedAt: '2026-10-05T09:00:00Z', recordedByName: '合成登记人' })), url)
    const rows = exceptions.filter(row => row.owning_domain === (p.startsWith('/finance') ? 'finance' : 'altoc') && (!q.get('kind') || q.get('kind') === row.kind))
    return pageResult(rows, url, { openCounts: Object.fromEntries(exceptions.map(row => [row.kind, 1])) })
  }
  if (p.includes('/finance/api/')) {
    if (p.endsWith('/reveal-account-no')) return { data: { code: account.code, accountNo: '0000000000000000000', revealedAt: new Date().toISOString() } }
    if (p.endsWith('/balance-entries')) return pageResult([1, 2].map(id => ({ id, account_code: account.code, balance_date: '2026-10-05', balance_amount: '12345678.90', currency_code: 'CNY', entry_source: id === 1 ? 'manual' : 'import', recorded_at: '2026-10-05T09:00:00Z', recorded_by_name: '合成用户', note: '合成登记备注（长备注视觉验证）', is_day_latest: id === 1 })), url)
    if (p.endsWith('/bank-accounts/balances')) return pageResult([snapshot], url, { balanceTotals: [{ legal_entity_code: entity.code, currency_code: 'CNY', account_count: 1, amount: snapshot.balance_amount }] })
    if (p.endsWith('/bank-accounts')) return pageResult([account], url, q.get('complete') === 'true' ? { complete: true } : {})
    if (p.includes('/bank-accounts/')) return { data: account }
    if (p.endsWith('/legal-entities')) return pageResult([entity], url)
    if (p.includes('/legal-entities/')) return { data: entity }
  }
  if (p.endsWith('/assets-summary') || p.endsWith('/documents-summary')) return { code: 0, data: { items: [], total: 0, access: 'allowed' } }
  if (p.endsWith('/service-finance-summary')) return { code: 0, data: { access: 'allowed', invoices: { access: 'allowed', currencyTotals: [] }, receipts: { access: 'allowed', currencyTotals: [] }, reconciliation: { access: 'allowed', currencyTotals: [] } } }
  if (/\/customers\/\d+$/.test(p)) return { code: 0, data: { ...(p.endsWith('/1') ? customer : children[0]), contacts: [contact], invoice_profiles: [] } }
  if (p.endsWith('/customers')) {
    const rows = q.get('parentId') ? children : q.get('rootsOnly') ? [customer] : [customer, ...children]
    return { code: 0, data: { items: rows, total: rows.length, page: Number(q.get('page') || 1), pageSize: Number(q.get('pageSize') || 20) } }
  }
  if (/\/contracts\/\d+$/.test(p)) return { code: 0, data: p.endsWith('/1') ? contract : childContract }
  if (p.endsWith('/contracts')) {
    const rows = q.get('parentContractId') ? [childContract] : [contract, childContract]
    return { code: 0, data: { items: rows, total: rows.length, rollup: { count: 2, terminatedCount: 0, excluded: true, amounts: [{ currency_code: 'CNY', amount: '12345678.90' }, { currency_code: 'USD', amount: '5000.00' }] }, customerSummaries: Object.fromEntries(children.map(row => [String(row.id), { count: 1, terminatedCount: 0, amounts: [{ currency_code: 'CNY', amount: '12345678.90' }] }])) } }
  }
  throw new Error(`Unregistered synthetic API: ${method} ${p}`)
}
