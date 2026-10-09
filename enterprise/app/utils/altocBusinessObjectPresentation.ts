export const altocContractStatusLabels: Record<string, string> = { active: '有效', inactive: '已停用', draft: '草稿', rejected: '已退回', pending_approval: '审批中', approved: '已批准', effective: '已生效', activated: '已启动', planned: '已计划', billable: '可开票', not_started: '未开始', in_progress: '进行中', submitted: '待验收', completed: '已完成', accepted: '已验收', cancelled: '已取消', canceled: '已取消', ready: '待启动', terminated: '已终止', invalid: '已失效', unplanned: '未计划', invoicing: '开票中', invoiced: '已开票', partially_invoiced: '部分开票', partially_received: '部分到账', received: '已到账', bad_debt: '坏账', partially_paid: '部分付款', paid: '已付款', partially_reconciled: '部分核销', reconciled: '已核销', pending: '待处理' }
export interface AltocBusinessObjectRow {
  id: number
  name?: string
  code?: string
  quotation_no?: string
  status?: string
}
export function altocBusinessObjectOptions(rows: AltocBusinessObjectRow[], kind: 'customers' | 'quotes') {
  return rows.map(row => ({
    value: String(row.id),
    label: kind === 'quotes' ? String(row.quotation_no || row.code || '报价') + (['approved', 'accepted'].includes(row.status || '') ? '' : '（尚不可转合同）') : String(row.name) + '（' + row.code + '）',
    disabled: kind === 'quotes' && !['approved', 'accepted'].includes(row.status || '')
  }))
}

export function requireAltocJsonMutationResult(result: unknown) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('未收到操作结果，请沿用同一请求重试')
  return result
}
