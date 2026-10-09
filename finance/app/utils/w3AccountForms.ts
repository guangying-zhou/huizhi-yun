import type { BankAccount, BankAccountInput } from '../types/hostFinance'
import { decimalInput, validEffectiveRange } from './hostFinanceForms.ts'

export function accountW3Patch(form: { shortName: string, bankBranchCode: string, legalEntityCode: string, accountSubtype: string, sortNo: number }, account: BankAccount | null): Partial<BankAccountInput> {
  // Preserve compatibility: absent W1 fields are not silently written as NULL.
  const fields = { shortName: form.shortName.trim() || null, bankBranchCode: form.bankBranchCode.trim() || null, legalEntityCode: form.legalEntityCode || null, accountSubtype: form.accountSubtype || null, sortNo: Number(form.sortNo) }
  if (!Number.isSafeInteger(fields.sortNo) || fields.sortNo < 0 || fields.sortNo > 1000000) throw new Error('排序号须为 0 至 1000000 的整数')
  if (fields.shortName && [...fields.shortName].length > 50) throw new Error('账户简称不能超过 50 字')
  if (fields.bankBranchCode && !/^[A-Za-z0-9-]{1,30}$/.test(fields.bankBranchCode)) throw new Error('行号须为最多 30 位字母、数字或连字符')
  if (account && Object.hasOwn(account, 'short_name')) return fields
  return Object.fromEntries(Object.entries(fields).filter(([key, value]) => key === 'sortNo' ? value !== 0 : value !== null))
}
export function balanceDraft(date: string, amount: string, note: string) {
  if (!validEffectiveRange(date, null)) throw new Error('请选择有效的对账日期')
  if ([...note.trim()].length > 500) throw new Error('备注不能超过 500 字')
  return { balanceDate: date, balanceAmount: decimalInput(amount, 2, true), note: note.trim() || null }
}
