// Decimal values stay strings throughout the UI and writes; never sum page rows.
export type Decimal = string
export interface BalanceTotal { legal_entity_code: string | null, currency_code: string, account_count: number, amount: Decimal }
export interface FinancePage<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  complete?: boolean
  balanceTotals?: BalanceTotal[]
}
export interface BankAccount {
  source_info?: Record<string, string>
  id: number
  code: string
  account_name: string
  bank_name: string | null
  account_no_masked: string | null
  account_type: 'bank' | 'cash' | 'third_party' | 'internal'
  currency_code: string
  owner_dept_code: string | null
  status: 'active' | 'inactive' | 'closed'
  row_version: number
  short_name?: string | null
  legal_entity_code?: string | null
  legal_entity_name?: string | null
  account_subtype?: string | null
  bank_branch_code?: string | null
  sort_no?: number
  latest_balance_amount?: Decimal | null
  latest_balance_date?: string | null
}
export interface BalanceSnapshot {
  id: number
  account_code: string
  account_name: string
  snapshot_date: string
  balance_amount: Decimal
  currency_code: string
  source_type: 'manual' | 'import' | 'api'
  note: string | null
  entry_count?: number | null
  latest_tie_count?: number | null
  distinct_amounts?: number | null
}
export interface PeopleCostParameter {
  id: number
  code: string
  name: string
  effective_from: string
  effective_to: string | null
  base_salary: Decimal
  welfare_cost_rate: Decimal
  management_allocation_rate: Decimal
  resource_allocation_cost: Decimal
  currency_code: string
  status: 'active' | 'inactive'
  remark: string | null
  row_version: number
}
export interface BankAccountInput {
  shortName?: string | null
  bankBranchCode?: string | null
  legalEntityCode?: string | null
  accountSubtype?: string | null
  sortNo?: number
  accountName: string
  bankName: string | null
  accountNoMasked: string | null
  accountNoSecretRef?: string
  accountType: BankAccount['account_type']
  currencyCode: string
  ownerDeptCode: string | null
}
export interface PeopleCostParameterInput {
  name: string
  effectiveFrom: string
  effectiveTo: string | null
  baseSalary: Decimal
  welfareCostRate: Decimal
  managementAllocationRate: Decimal
  resourceAllocationCost: Decimal
  currencyCode: string
  status: PeopleCostParameter['status']
  remark: string | null
}
export interface FinanceQuery { page: number, pageSize: number, search?: string, status?: string, legalEntityCode?: string, accountType?: string, complete?: boolean, accountCode?: string, startDate?: string, endDate?: string }

export type FinanceListQuery = Pick<FinanceQuery, 'page' | 'pageSize' | 'search' | 'status' | 'legalEntityCode' | 'accountType' | 'complete'>
export type FinanceSnapshotQuery = Pick<FinanceQuery, 'page' | 'pageSize' | 'search' | 'legalEntityCode' | 'accountCode' | 'startDate' | 'endDate'>
export type FinanceHistoryQuery = Pick<FinanceQuery, 'page' | 'pageSize'>

export interface LegalEntity { id: number, code: string, name: string, short_name: string | null, unified_social_credit_code: string | null, entity_type: 'company' | 'branch' | 'other', registered_address: string | null, invoice_title: string | null, invoice_tax_no: string | null, status: 'active' | 'inactive', sort_no: number, remark: string | null, row_version: number, account_count?: number }
export interface LegalEntityInput { name: string, shortName: string | null, unifiedSocialCreditCode: string | null, entityType: LegalEntity['entity_type'], invoiceTitle: string | null, invoiceTaxNo: string | null, registeredAddress: string | null, sortNo: number, remark: string | null }
export interface BalanceEntry { id: number, account_code: string, balance_date: string, balance_amount: string, currency_code: string, entry_source: 'manual' | 'import', recorded_at: string, recorded_by: string | null, recorded_by_name: string | null, note: string | null, is_day_latest: boolean }
export interface BalanceEntryInput { balanceDate: string, balanceAmount: string, note: string | null }
