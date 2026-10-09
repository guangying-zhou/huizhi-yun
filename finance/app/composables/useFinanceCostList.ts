import type { CostKind, CostPage, CostRow } from '../utils/hostFinanceCost'
import { costReadMessage } from '../utils/hostFinanceCost'
import { useFinanceModule } from '../../layer/useFinanceModule'

export function useFinanceCostList(kind: CostKind, allowed: Ref<boolean>, month: Ref<string>, project: Ref<string>) {
  const { apiUrl, sessionScope } = useFinanceModule()
  const page = ref(1), pageSize = 20
  const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
    page.value = 1
  } })
  const items = ref<CostRow[]>([]), total = ref(0), pending = ref(false), error = ref('')
  let generation = 0
  watch([month, project], () => {
    page.value = 1
  }, { flush: 'sync' })
  async function refresh() {
    const epoch = ++generation
    items.value = []
    total.value = 0
    error.value = ''
    pending.value = false
    if (!allowed.value)
      return
    pending.value = true
    try {
      const response = await $fetch<CostPage>(apiUrl(`/${kind}`), { query: { periodMonth: month.value, ...(project.value ? { projectCode: project.value } : {}), page: page.value, pageSize, ...(debounced.value ? { search: debounced.value } : {}) }, retry: 0 })
      if (epoch !== generation || !allowed.value)
        return
      if (!Array.isArray(response.data) || !Number.isSafeInteger(response.total) || response.page !== page.value || response.pageSize !== pageSize)
        throw new Error('Invalid cost page')
      items.value = response.data
      total.value = response.total
    } catch (failure) {
      if (epoch === generation)
        error.value = costReadMessage(failure)
    } finally {
      if (epoch === generation)
        pending.value = false
    }
  }
  watch(() => JSON.stringify([allowed.value, month.value, project.value, debounced.value, page.value, sessionScope?.value]), () => {
    void refresh()
  }, { immediate: true })
  onScopeDispose(() => {
    generation++
  })
  return { page, pageSize, search, flush, items, total, pending, error, refresh }
}
