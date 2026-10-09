import type { FinancePage, FinanceQuery, BalanceTotal } from '../types/hostFinance'

export function useFinancePagedList<T>(read: (query: FinanceQuery) => Promise<FinancePage<T>>, allowed: Ref<boolean>, initialQuery: Partial<FinanceQuery> = {}) {
  const page = ref(Number.isSafeInteger(initialQuery.page) && Number(initialQuery.page) > 0 ? Number(initialQuery.page) : 1)
  const legalEntityCode = ref(initialQuery.legalEntityCode || '')
  const accountType = ref(initialQuery.accountType || 'all')
  const completeRequested = ref(false)
  const complete = ref(false)
  const pageSize = 20
  const status = ref(initialQuery.status || 'all')
  const accountCode = ref(initialQuery.accountCode || '')
  const startDate = ref(initialQuery.startDate || '')
  const endDate = ref(initialQuery.endDate || '')
  const { search, debounced, flush } = useDebouncedSearch({ initial: initialQuery.search || '', onChange: () => {
    page.value = 1
  } })
  const items = ref<T[]>([]) as Ref<T[]>
  const total = ref(0)
  const balanceTotals = ref<BalanceTotal[]>([])
  const pending = ref(false)
  const error = ref('')
  const sessionScope = useState<string>('enterprise-cache-scope', () => '')
  let generation = 0
  const query = computed<FinanceQuery>(() => ({ page: page.value, pageSize, legalEntityCode: legalEntityCode.value || undefined, accountType: accountType.value === 'all' ? undefined : accountType.value, ...(completeRequested.value && page.value === 1 ? { complete: true } : {}), search: debounced.value || undefined, status: status.value === 'all' ? undefined : status.value, accountCode: accountCode.value || undefined, startDate: startDate.value || undefined, endDate: endDate.value || undefined }))
  watch([legalEntityCode, accountType, completeRequested, status, accountCode, startDate, endDate], () => {
    page.value = 1
  }, { flush: 'sync' })
  async function refresh() {
    const epoch = ++generation
    items.value = []
    total.value = 0
    balanceTotals.value = []
    complete.value = false
    error.value = ''
    if (!allowed.value) {
      pending.value = false
      return
    }
    if (startDate.value && endDate.value && startDate.value > endDate.value) {
      pending.value = false
      error.value = '结束日期不能早于开始日期'
      return
    }
    pending.value = true
    try {
      const response = await read(query.value)
      if (epoch !== generation || !allowed.value) return
      if (!Array.isArray(response.data) || !Number.isSafeInteger(response.total) || response.total < 0 || response.page !== page.value || response.pageSize !== pageSize) throw new Error('Invalid Finance page')
      if (response.complete === true && (!completeRequested.value || response.total > 200 || response.data.length !== response.total)) throw new Error('Invalid complete account result')
      complete.value = response.complete === true
      items.value = response.data
      total.value = response.total
      balanceTotals.value = response.balanceTotals || []
    } catch (failure) {
      const statusCode = (failure as { statusCode?: number, status?: number }).statusCode || (failure as { status?: number }).status
      if (epoch === generation) error.value = statusCode === 403 ? '您没有查看这些财务单据的权限' : '财务数据暂不可用，请稍后重试'
    } finally {
      if (epoch === generation) pending.value = false
    }
  }
  watch(() => JSON.stringify([query.value, allowed.value, sessionScope.value]), () => {
    void refresh()
  }, { immediate: true })
  onScopeDispose(() => {
    generation++
  })
  return { query, page, pageSize, legalEntityCode, accountType, completeRequested, complete, status, accountCode, startDate, endDate, search, flush, items, total, balanceTotals, pending, error, refresh }
}
