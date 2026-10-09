export const financeSettings = {
  'expense-types': { title: '费用类型', path: '/settings/expense-types', fields: ['code', 'name', 'defaultSubjectId', 'costCategory', 'reimbursable', 'sortNo', 'status', 'remark'] },
  'income-types': { title: '收入类型', path: '/settings/income-types', fields: ['code', 'name', 'defaultSubjectId', 'isContractIncome', 'sortNo', 'status', 'remark'] },
  'subjects': { title: '财务科目', path: '/settings/subjects', fields: ['code', 'name', 'subjectType', 'parentId', 'sortNo', 'status', 'remark'] },
  'subject-mappings': { title: '科目映射', path: '/settings/subject-mappings', fields: ['bizType', 'bizSubtype', 'incomeTypeCode', 'expenseTypeCode', 'defaultSubjectCode', 'objectStrategy', 'requiredDimensions', 'sortNo', 'status', 'remark'] },
  'accounting-objects': { title: '核算对象', path: '/accounting-objects', fields: ['code', 'name', 'objectType', 'status', 'remark'] },
  'audit-logs': { title: '财务审计', path: '/audit-logs', fields: [] },
  'approval-instances': { title: '审批关联', path: '/integrations/approval-instances', fields: [] }
} as const
export type FinanceSettingsKind = keyof typeof financeSettings
export const settingsFieldLabels: Record<string, string> = {
  code: '编码', name: '名称', defaultSubjectId: '默认科目 ID', costCategory: '成本分类', reimbursable: '允许报销', isContractIncome: '合同收入', sortNo: '排序', status: '状态', remark: '备注', subjectType: '科目类型', parentId: '上级科目 ID', bizType: '业务类型', bizSubtype: '业务子类型', incomeTypeCode: '收入类型编码', expenseTypeCode: '费用类型编码', defaultSubjectCode: '默认科目编码', objectStrategy: '核算对象策略', requiredDimensions: '必需维度（逗号分隔）', objectType: '对象类型'
}
export const settingsEnums: Record<string, Array<{ label: string, value: string }>> = {
  status: [{ label: '有效', value: 'active' }, { label: '停用', value: 'inactive' }],
  subjectType: ['asset', 'liability', 'equity', 'cost', 'profit_loss'].map((value, index) => ({ value, label: ['资产', '负债', '权益', '成本', '损益'][index]! })),
  costCategory: ['project', 'sales', 'admin', 'finance', 'hr', 'asset', 'other'].map((value, index) => ({ value, label: ['项目', '销售', '管理', '财务', '人力', '资产', '其他'][index]! })),
  bizType: ['receipt', 'expense', 'claim', 'payment', 'no_contract_income'].map((value, index) => ({ value, label: ['到账', '支出', '报销', '付款', '非合同收入'][index]! })),
  objectType: ['customer_project', 'internal_project', 'department', 'contract', 'customer', 'sales_region', 'opportunity', 'sales_campaign', 'employee', 'other'].map((value, index) => ({ value, label: ['客户项目', '内部项目', '部门', '合同', '客户', '销售区域', '商机', '销售活动', '员工', '其他'][index]! }))
}
const numbers = new Set(['defaultSubjectId', 'parentId', 'sortNo'])
export function settingsPayload(kind: FinanceSettingsKind, form: Record<string, unknown>, editing: boolean, version?: number) {
  const body: Record<string, unknown> = {}
  for (const field of financeSettings[kind].fields) {
    if (editing && field === 'code') continue
    const value = form[field]
    if (['reimbursable', 'isContractIncome'].includes(field)) body[field] = !!value
    else if (field === 'requiredDimensions') body[field] = String(value || '').split(',').map(v => v.trim()).filter(Boolean)
    else if (numbers.has(field)) {
      if (String(value ?? '').trim()) body[field] = Number(value)
      else if (editing && field !== 'sortNo') body[field] = null
    } else if (String(value ?? '').trim()) body[field] = String(value).trim()
    else if (editing && !['name', 'status', 'subjectType', 'bizType', 'defaultSubjectCode', 'objectStrategy', 'objectType'].includes(field)) body[field] = ['bizSubtype', 'incomeTypeCode', 'expenseTypeCode'].includes(field) ? '' : null
  }
  if (editing) body.expectedVersion = version
  return body
}
