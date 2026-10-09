import type { BankAccount, BalanceSnapshot } from '../types/hostFinance'

export function w3AccountTypeLabel(account: BankAccount) {
  const types = { bank: '银行账户', cash: '现金', third_party: '第三方', internal: '内部账户' }
  const subtypes: Record<string, string> = { basic: '基本户', general: '一般户', special: '专户', loan: '贷款户' }
  return [types[account.account_type], account.account_type === 'bank' && account.account_subtype ? subtypes[account.account_subtype] || '其他子类型' : ''].filter(Boolean).join(' · ')
}
export function w3BalanceFlags(snapshot: BalanceSnapshot) {
  return [Number(snapshot.distinct_amounts) > 1 ? '当日改过数' : '', Number(snapshot.latest_tie_count) > 1 ? '同时刻多条（金额一致）' : ''].filter(Boolean)
}
