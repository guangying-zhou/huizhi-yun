export const customerFieldLimits: Record<string, number> = {
  name: 200, short_name: 100, unified_social_credit_code: 50, organization_domain: 200,
  industry_code: 64, region_code: 64, source_type: 50, credit_level: 20, website: 300,
  telephone: 30, province: 50, city: 50, address: 500, wechat_official_account: 100,
  description: 10000, remark: 500, owner_uid: 64, owner_dept_code: 64,
  dept_name: 100, job_title: 100, mobile: 30, alternate_mobile: 30, phone: 30, email: 100,
  wechat: 100, mailing_address: 500, decision_role: 30, influence_level: 20,
  taxpayer_name: 200, taxpayer_no: 50, registered_address: 500, registered_phone: 50,
  bank_name: 200, bank_account: 100, invoice_type: 30, invoice_email: 100,
  receiver_name: 100, receiver_phone: 50, receiver_address: 500, status: 20
}
export function customerFieldLimit(mode: string, key: string) {
  return mode === 'contact' && key === 'name' ? 50 : customerFieldLimits[key] || 500
}
export function validateCustomerFields(mode: string, fields: string[], draft: Record<string, string>) {
  const errors: Record<string, string> = {}
  const required = mode === 'owner' ? ['owner_uid'] : mode === 'invoice' ? ['taxpayer_name', 'invoice_type'] : mode === 'contact' ? ['name'] : ['name', ...(fields.includes('owner_uid') ? ['owner_uid'] : [])]
  for (const key of required) if (!draft[key]?.trim()) errors[key] = key === 'owner_uid' ? '请选择负责人' : key === 'invoice_type' ? '请选择发票类型' : '请填写此必填项'
  for (const key of fields) {
    const value = draft[key]?.trim() || ''
    if ([...value].length > customerFieldLimit(mode, key)) errors[key] = `最多${customerFieldLimit(mode, key)}个字符`
    if ([...value].some(c => c.codePointAt(0)! < 32 || c.codePointAt(0) === 127)) errors[key] = '此字段不支持换行或控制字符，请填写连续文字'
  }
  return errors
}
export function altocValidationMessage(error: unknown) {
  const status = Number((error as { statusCode?: number, status?: number }).statusCode || (error as { status?: number }).status)
  if (status === 400) return '资料格式不正确，请核对标注的必填项、字段长度和所选人员。'
  if (status === 409) return '数据版本已变化或操作意图冲突，请重试原操作，或刷新后重新编辑。'
  if (status === 403) return '当前无权执行此操作，请刷新权限后重试。'
  return '保存未完成，请重试原操作；系统会使用原操作键避免重复创建。'
}

/** Read Vue proxies into plain transport facts before the intent snapshots them. */
export function quotationItemsPayload(expectedVersion: unknown, items: Array<{ item_name: string, specification: string, unit: string, quantity: string, unit_price: string, discount_rate: string, tax_rate: string }>) {
  return { expectedVersion, items: items.map(item => ({ item_name: item.item_name, specification: item.specification, unit: item.unit, quantity: item.quantity, unit_price: item.unit_price, discount_rate: item.discount_rate, tax_rate: item.tax_rate })) }
}
