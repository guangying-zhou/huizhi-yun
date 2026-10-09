import { decimalInput, validEffectiveRange } from './hostFinanceForms.ts'

export function ledgerRequiredFields(kind: string, mode: string): string[] {
  if (mode === 'issue') return ['invoiceNo', 'invoiceDate']
  if (mode === 'assign-issuance') return ['responsibleUid', 'dueAt']
  if (mode === 'void') return ['reason']
  if (mode === 'classify') return ['incomeTypeId']
  if (kind === 'invoice-requests') return ['invoiceItem', 'requestedAmount', 'currencyCode']
  if (kind === 'receipts') return ['receivedAmount', 'receivedAt', 'currencyCode', 'responsibleUid', 'dueAt']
  if (kind === 'reconciliation') return ['receiptCode', 'reconciledAmount', 'currencyCode']
  return []
}
export function validateLedgerForm(kind: string, mode: string, form: Record<string, string>, fields: Array<{ key: string, label: string, type?: string, amount?: boolean }>, hasAttachment: boolean) {
  const errors: Record<string, string> = {}
  const required = ledgerRequiredFields(kind, mode)
  for (const field of fields) {
    const value = (form[field.key] || '').trim()
    if (!value) {
      if (required.includes(field.key)) errors[field.key] = `请填写${field.label}`
      continue
    }
    if (field.amount) {
      try {
        const amount = decimalInput(value, 2)
        if (!/[1-9]/.test(amount)) errors[field.key] = '金额必须大于 0'
      } catch { errors[field.key] = '请输入大于 0、最多两位小数的有效金额' }
    }
    if (field.type === 'date' && !validEffectiveRange(value, null)) errors[field.key] = '请选择有效日期'
    if (field.type === 'datetime-local' && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !validEffectiveRange(value.slice(0, 10), null) || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59)) errors[field.key] = '请选择有效截止时间'
    if (field.key === 'currencyCode' && !/^[A-Z]{3}$/.test(value)) errors[field.key] = '请输入三位大写币种代码'
    if (['bankAccountId', 'incomeTypeId'].includes(field.key) && !/^[1-9]\d*$/.test(value)) errors[field.key] = '请选择有效记录'
  }
  if (mode === 'issue' && !hasAttachment) errors.attachment = '请上传发票 PDF/OFD 附件'
  return errors
}
