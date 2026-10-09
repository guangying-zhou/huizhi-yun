import type { LegalEntity, LegalEntityInput, BalanceEntry, BalanceEntryInput, BankAccount, BankAccountInput, BalanceSnapshot, FinancePage, FinanceQuery, FinanceListQuery, FinanceSnapshotQuery, FinanceHistoryQuery, PeopleCostParameter, PeopleCostParameterInput } from '../types/hostFinance'

export interface FinanceFetchOptions { method?: 'GET' | 'POST' | 'PATCH', query?: FinanceQuery | { date: string, page: number, pageSize: number }, body?: unknown, headers?: Record<string, string>, retry: 0 }
export type FinanceFetch = <T>(url: string, options: FinanceFetchOptions) => Promise<T>
export function createHostFinanceClient(fetch: FinanceFetch, apiUrl: (path: string) => string) {
  const selectQuery = (query: FinanceQuery, keys: (keyof FinanceQuery)[]) => ({ page: query.page, pageSize: query.pageSize, ...Object.fromEntries(keys.filter(key => key !== 'page' && key !== 'pageSize' && query[key] !== undefined && query[key] !== '').map(key => [key, query[key]])) })
  const listQuery = (query: FinanceListQuery) => selectQuery(query, ['page', 'pageSize', 'search', 'status'])
  const read = <T>(path: string, query?: FinanceFetchOptions['query']) => fetch<T>(apiUrl(path), { query, retry: 0 })
  const write = <T>(path: string, method: 'POST' | 'PATCH', body: unknown, key: string) => fetch<T>(apiUrl(path), { method, body, headers: { 'Idempotency-Key': key }, retry: 0 })
  return {
    entities: (query: FinanceListQuery) => read<FinancePage<LegalEntity>>('/legal-entities', listQuery(query)),
    entity: (code: string) => read<{ data: LegalEntity }>(`/legal-entities/${encodeURIComponent(code)}`),
    createEntity: (body: LegalEntityInput, key: string) => write<{ data: LegalEntity }>('/legal-entities', 'POST', body, key),
    updateEntity: (code: string, patch: Partial<LegalEntityInput> & { status?: LegalEntity['status'], expectedVersion: number }, key: string) => write<{ data: LegalEntity }>(`/legal-entities/${encodeURIComponent(code)}`, 'PATCH', patch, key),
    balanceEntries: (code: string, date: string, page = 1) => read<FinancePage<BalanceEntry>>(`/bank-accounts/${encodeURIComponent(code)}/balance-entries`, { date, page, pageSize: 20 }),
    registerBalance: (code: string, body: BalanceEntryInput, key: string) => write<{ data: BalanceEntry }>(`/bank-accounts/${encodeURIComponent(code)}/balance-entries`, 'POST', body, key),
    revealAccountNo: (code: string, reason: string) => fetch<{ data: { code: string, accountNo: string, revealedAt: string } }>(apiUrl(`/bank-accounts/${encodeURIComponent(code)}/reveal-account-no`), { method: 'POST', body: { reason }, retry: 0 }),
    accounts: (query: FinanceListQuery) => read<FinancePage<BankAccount>>('/bank-accounts', selectQuery(query, ['page', 'pageSize', 'search', 'status', 'legalEntityCode', 'accountType', 'complete'])),
    account: (code: string) => read<{ data: BankAccount }>(`/bank-accounts/${encodeURIComponent(code)}`),
    snapshots: (query: FinanceSnapshotQuery) => read<FinancePage<BalanceSnapshot>>('/bank-accounts/balances', selectQuery(query, ['page', 'pageSize', 'search', 'legalEntityCode', 'accountCode', 'startDate', 'endDate'])),
    parameters: (query: FinanceListQuery) => read<FinancePage<PeopleCostParameter>>('/settings/people-cost-parameters', listQuery(query)),
    parameterHistory: (code: string, query: FinanceHistoryQuery) => read<FinancePage<PeopleCostParameter>>(`/settings/people-cost-parameters/${encodeURIComponent(code)}/history`, { page: query.page, pageSize: query.pageSize }),
    parameter: (code: string) => read<{ data: PeopleCostParameter }>(`/settings/people-cost-parameters/${encodeURIComponent(code)}`),
    createAccount: (body: BankAccountInput, key: string) => write<{ data: BankAccount }>('/bank-accounts', 'POST', body, key),
    updateAccount: (code: string, patch: Partial<BankAccountInput> & { status?: BankAccount['status'], expectedVersion: number }, key: string) => write<{ data: BankAccount }>(`/bank-accounts/${encodeURIComponent(code)}`, 'PATCH', patch, key),
    createParameter: (body: PeopleCostParameterInput, key: string) => write<{ data: PeopleCostParameter }>('/settings/people-cost-parameters', 'POST', body, key),
    updateParameter: (code: string, patch: PeopleCostParameterInput & { expectedVersion: number }, key: string) => write<{ data: PeopleCostParameter }>(`/settings/people-cost-parameters/${encodeURIComponent(code)}`, 'PATCH', patch, key)
  }
}
