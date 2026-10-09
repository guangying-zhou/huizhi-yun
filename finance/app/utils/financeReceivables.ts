export type ReceivableMode = 'continuation' | 'allocate' | 'adjustments' | 'adjust-new' | 'adjust-detail' | 'batches' | 'batch-detail'
export interface ReceivableFact { code: string, row_version: number, status?: string, amount?: string, opening_amount?: string, cutoff_date?: string, review_hash?: string, evidence_sha256?: string, billing_schedule_code?: string, contract_code?: string, currency_code?: string, entered_by?: string, [key: string]: unknown }
export interface AllocationCandidate extends ReceivableFact { name: string, outstanding_amount: string }
export const adjustmentTypes = [{ label: '折让', value: 'discount' }, { label: '部分坏账', value: 'bad_debt' }, { label: '尾差', value: 'rounding' }, { label: '调整', value: 'correction' }]
export const receivableTitles: Record<ReceivableMode, string> = { 'continuation': '历史财务接续', 'allocate': '到账分配', 'adjustments': '应收调整', 'adjust-new': '录入应收调整', 'adjust-detail': '应收调整详情', 'batches': '分配批次', 'batch-detail': '分配批次详情' }
export function allocationPayload(receiptVersion: number, candidates: AllocationCandidate[], amounts: Record<string, string>) {
  const items = candidates.filter(row => Number(amounts[row.code]) > 0).map(row => ({ contractCode: row.contract_code, billingScheduleCode: row.code, scheduleVersion: row.row_version, amount: amounts[row.code] }))
  if (!items.length) throw new Error('请至少选择一个分配目标并填写金额')
  if (items.some(row => !/^\d+(\.\d{1,2})?$/.test(row.amount || ''))) throw new Error('分配金额最多保留两位小数')
  return { receiptVersion, items }
}
export function receivableMessage(error: unknown) {
  if (error instanceof Error && ['请至少选择一个分配目标并填写金额', '分配金额最多保留两位小数', '请填写调整金额与原因', '请填写合同、结算计划、有效金额和调整原因', '请重新选择结算计划', '请填写撤销原因'].includes(error.message)) return error.message
  const e = (error || {}) as { data?: { code?: string, data?: { code?: string } }, statusCode?: number, status?: number }
  const code = e.data?.data?.code || e.data?.code
  const messages: Record<string, string> = {
    finance_before_opening_cutoff: '到账日期必须晚于净期初快照日，历史回款不参与接续核销',
    finance_adjustment_self_confirmation_denied: '录入人不能确认或撤销自己的调整，请由另一位获权人员办理',
    finance_historical_contract_not_ready: '历史合同尚未完成财务接续，请先核验并激活',
    finance_opening_cutoff_missing: '期初证据缺少快照日，须补齐受审证据后再激活',
    finance_opening_evidence_changed: '期初证据或版本已变化，请刷新比较',
    finance_legal_entity_not_ready: '收款账户或合同法人主体尚未就绪，不能分配',
    finance_legal_entity_mismatch: '到账与合同的法人主体不一致，不能分配',
    finance_amount_exceeded: '金额超过未结余额，请刷新比较；选择已保留',
    finance_receivables_unavailable: '财务接续尚未安装，当前不可办理'
  }
  return messages[code || ''] || (e.statusCode === 409 || e.status === 409 ? '内容或版本已变化，请刷新比较；草稿与选择已保留' : e.statusCode === 403 || e.status === 403 ? '您没有办理权限或当前责任关系已变更' : (e.statusCode || e.status || 0) >= 500 ? '服务暂时不可用，请重试；草稿已保留' : '保存结果未确认，可能已提交，重试将沿用同一请求安全续行；草稿已保留')
}

export function receivableStatusLabel(status?: string) {
  return ({ pending: '待核验', draft: '待确认', confirmed: '已确认', active: '有效', reversed: '已撤销' } as Record<string, string>)[status || ''] || '未知状态'
}

// Reads cannot have an uncertain-save result, and never imply a retained draft.
export function receivableReadMessage(error: unknown) {
  const e = (error || {}) as { data?: { code?: string, data?: { code?: string } }, statusCode?: number, status?: number }
  const code = e.data?.data?.code || e.data?.code
  const messages: Record<string, string> = {
    finance_opening_evidence_missing: '未找到此合同的净期初证据，暂不可激活',
    finance_opening_evidence_invalid: '净期初证据未通过核验，暂不可激活',
    finance_opening_evidence_changed: '净期初证据或版本已变化，请刷新核验，暂不可激活',
    finance_opening_cutoff_missing: '净期初证据缺少快照日，暂不可激活',
    finance_opening_already_used: '此合同已有后续财务记录，请核对后再办理接续',
    finance_receivables_unavailable: '财务接续尚未安装，当前不可用',
    finance_object_not_found: '未找到此合同的保全映射'
  }
  return messages[code || ''] || ((e.statusCode || e.status) === 403 ? '您没有查看此合同的权限' : '读取失败，请重试')
}

export function historicalStatusLabel(status?: string) {
  return status === 'active' ? '已激活' : '待核验'
}
