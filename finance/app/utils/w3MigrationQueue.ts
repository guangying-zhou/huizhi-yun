export type QueueRow = Record<string, unknown>
export type QueueApp = 'altoc' | 'finance'
export const queueKinds: Record<QueueApp, Record<string, string>> = {
  altoc: { owner_unmatched: '负责人待匹配', contact_without_customer: '联系人待归属', contact_orphan: '联系人关联缺失', contract_contact_mismatch: '合同联系人客户不一致', primary_contact_mismatch: '主联系人不一致', effective_amount_exceeds_total: '有效金额待核对', identity_source_missing: '源人员缺失' },
  finance: { contract_balance_mismatch: '合同余额差异（只读）', balance_without_account: '余额待认领', balance_latest_conflict: '同日余额冲突' }
}
export const queueStatuses: Record<string, string> = { open: '待处理', resolved: '已处理', accepted: '已接受现状', superseded: '已替代', candidate: '待确认', confirmed: '已确认', rejected: '无对应人员', unmatched: '待匹配', source_missing: '源记录缺失' }
export const queueMethodLabels: Record<string, string> = { assign_customer: '归属到客户', link_existing: '关联已有联系人', accept: '接受现状', reopen: '重新打开', mark_done: '标记已处理', record_balance: '登记余额', confirm: '确认匹配', reject: '标记无对应人员', apply: '应用到名下对象' }
export const queueConflictCodes = ['migration_exception_version_conflict', 'migration_exception_state_conflict', 'migration_exception_method_not_applicable', 'migration_contact_duplicate', 'migration_contact_invalid', 'migration_identity_state_conflict', 'migration_identity_self_match', 'migration_identity_target_invalid', 'migration_balance_account_invalid', 'migration_balance_amount_invalid', 'migration_target_unavailable', 'finance_historical_contract_not_ready']
export function queueError(error: unknown) {
  const e = error as { statusCode?: number, status?: number, response?: { status?: number }, data?: { code?: string, data?: { code?: string } }, message?: string }
  const code = String(e.data?.data?.code || e.data?.code || '')
  const messages: Record<string, string> = { migration_contact_duplicate: '该客户已有同名同手机联系人，请选择关联已有联系人', migration_identity_self_match: '不能将源人员匹配到当前操作者，请由另一名有权用户处理', migration_identity_target_invalid: '目标目录用户不存在或不在职，请重新选择', migration_balance_amount_invalid: '只能从事项列出的候选金额中选择', finance_historical_contract_not_ready: '历史合同财务输入尚未就绪，请先完成财务核对' }
  if (messages[code]) return messages[code]
  const status = Number(e.statusCode || e.status || e.response?.status)
  if (status === 403) return '没有处理权限或目标对象不在您的范围内'
  if (status === 409) return '事项已变更或当前状态不允许此操作；填写内容已保留，请刷新比较'
  if (status === 503) return '迁移事项暂不可用，请稍后重试'
  if (!status && e instanceof Error && !/fetch|network/i.test(e.message)) return e.message
  return '请求结果未确认，请保持填写内容并沿用原请求重试'
}
export function queueMethods(row: QueueRow, resolve: boolean, customerEdit: boolean) {
  if (!resolve) return []
  const kind = String(row.kind), status = String(row.status)
  const accepting = ['contact_without_customer', 'contact_orphan', 'contract_contact_mismatch', 'primary_contact_mismatch', 'effective_amount_exceeds_total', 'identity_source_missing', 'balance_without_account'].includes(kind)
  if (status === 'accepted') return accepting ? ['reopen'] : []
  if (status !== 'open') return []
  if (kind === 'contact_without_customer') return [...customerEdit ? ['assign_customer', 'link_existing'] : [], 'accept']
  if (['contact_orphan', 'contract_contact_mismatch', 'primary_contact_mismatch'].includes(kind)) return ['mark_done', 'accept']
  if (['balance_without_account', 'balance_latest_conflict'].includes(kind)) return ['record_balance', ...accepting ? ['accept'] : []]
  return accepting ? ['accept'] : []
}
export function queueQuery(view: string, kind: string, status: string, page: number, search: string, pageSize = 20) {
  return { page, pageSize, ...(view === 'exceptions' && kind ? { kind } : {}), ...(status ? { status } : {}), ...((view === 'identities' || kind === 'contact_without_customer') && search.trim() ? { search: search.trim() } : {}) }
}
export function queuePage(response: unknown) {
  const r = response as { data?: QueueRow[], total?: number, page?: number, pageSize?: number, openCounts?: Record<string, number> }
  if (!Array.isArray(r?.data) || !Number.isSafeInteger(r.total) || Number(r.total) < r.data.length) throw Error('列表响应无效，请重试')
  return { rows: r.data, total: Number(r.total), openCounts: r.openCounts || {} }
}
export function queueDetail(row: QueueRow) {
  const d = (row.detail || {}) as Record<string, unknown>
  const fields: Record<string, string[]> = { effective_amount_exceeds_total: ['totalAmount', 'effectiveAmount'], contract_balance_mismatch: ['recomputedAmount', 'cachedAmount', 'difference'], balance_without_account: ['balanceDate', 'entryCount'], balance_latest_conflict: ['balanceDate'] }
  const labels: Record<string, string> = { totalAmount: '合同总额', effectiveAmount: '有效金额', recomputedAmount: '重算值', cachedAmount: '原缓存值', difference: '差额', balanceDate: '日期', entryCount: '登记条数' }
  return (fields[String(row.kind)] || []).map(key => ({ label: labels[key], value: d[key] === null || d[key] === undefined ? '—' : String(d[key]) }))
}
export function queueResolvePayload(row: QueueRow, method: string, draft: Record<string, string>) {
  const body: Record<string, unknown> = { expectedVersion: Number(row.row_version), method }
  if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) throw Error('事项版本不可用，请刷新')
  const reason = draft.reason?.trim() || ''
  if (reason.length > 500 || (method === 'accept' && row.kind === 'effective_amount_exceeds_total' && !reason)) throw Error('请填写核对原因（不超过 500 字）')
  if (reason) body.reason = reason
  if (['assign_customer', 'link_existing'].includes(method)) {
    if (!/^[1-9]\d*$/.test(draft.customerId || '')) throw Error('请选择有权编辑的客户')
    body.customerId = draft.customerId
    if (method === 'link_existing') {
      if (!draft.contactCode) throw Error('请选择该客户已有联系人')
      body.contactCode = draft.contactCode
    }
  }
  if (method === 'record_balance') {
    const d = (row.detail || {}) as { latestAmounts?: unknown[] }
    if (!d.latestAmounts?.includes(draft.amount)) throw Error('请选择事项列出的候选金额')
    if (row.kind === 'balance_without_account' && !draft.accountCode) throw Error('请选择认领账户')
    body.amount = draft.amount
    if (row.kind === 'balance_without_account') body.accountCode = draft.accountCode
  }
  return body
}
export function identityMethods(row: QueueRow, resolve: boolean, customerEdit: boolean, contractEdit: boolean) {
  if (!resolve || !/^(employee|user):[0-9]+$/.test(String(row.source_user_id))) return []
  const status = String(row.match_status)
  return [...['candidate', 'unmatched', 'rejected'].includes(status) ? ['confirm'] : [], ...['candidate', 'unmatched', 'confirmed'].includes(status) ? ['reject'] : [], ...status === 'confirmed' && String(row.source_user_id).startsWith('employee:') && Number(row.open_owner_items) > 0 && customerEdit && contractEdit ? ['apply'] : []]
}
export function queueApplyResult(reply: unknown) {
  const r = reply as { resolved?: number, remaining?: number, items?: QueueRow[] }
  if (!r || !Number.isSafeInteger(r.resolved) || Number(r.resolved) < 0 || Number(r.resolved) > 100 || !Number.isSafeInteger(r.remaining) || Number(r.remaining) < 0 || !Array.isArray(r.items) || r.items.length > 100 || r.items.some(item => !item || !['resolved', 'failed'].includes(String(item.status)))) throw Error('批次结果未确认，请沿用原请求重试')
  return { resolved: Number(r.resolved), remaining: Number(r.remaining), items: r.items }
}

// Presentation is a closed projection; source row_json and financial secrets
// must never become optional columns or browser preferences.
export const queueOptionalColumns = [{ key: 'source', label: '来源引用' }, { key: 'created_at', label: '迁入时间' }, { key: 'resolved_at', label: '处理时间' }, { key: 'row_version', label: '版本' }, { key: 'id', label: '事项 ID' }]
export function queueColumnPreference(value: unknown): string[] {
  const columns = value && typeof value === 'object' ? (value as { columns?: unknown }).columns : null
  return Array.isArray(columns) ? [...new Set(columns.filter((key): key is string => typeof key === 'string' && queueOptionalColumns.some(column => column.key === key)))] : ['created_at']
}
export function queueNextStep(row: QueueRow, view: string, canResolve: boolean, customerEdit: boolean, contractEdit: boolean) {
  const methods = view === 'identities' ? identityMethods(row, canResolve, customerEdit, contractEdit) : queueMethods(row, canResolve, customerEdit)
  if (methods.length) return methods.map(method => queueMethodLabels[method]).join(' / ')
  if (row.kind === 'contract_balance_mismatch') return '查看差异证据；到合同财务核对'
  if (['resolved', 'superseded'].includes(String(row.status))) return '查看处理结果'
  if (!canResolve) return '只读；需迁移事项处理权限'
  return view === 'identities' ? '核对源人员与当前匹配状态' : '查看证据；当前无可用办理动作'
}
