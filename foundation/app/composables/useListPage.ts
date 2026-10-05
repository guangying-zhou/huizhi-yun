import type { Ref } from 'vue'

type ListFilterValue = string | number | boolean | null | undefined

export interface UseListPageOptions {
  /** 每页数量。服务端列表必须把它作为 pageSize 传入请求。 */
  pageSize?: number
  /** 需要与 URL query 同步的筛选 ref，键名即 query 参数名。 */
  filters?: Record<string, Ref<ListFilterValue>>
  /** 重置筛选时使用的默认值；未提供时使用 composable 初始化时的值。 */
  defaults?: Record<string, ListFilterValue>
  /** 是否同步 URL，默认开启。 */
  syncUrl?: boolean
}

function queryText(value: unknown) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
}

function parseFilterValue(value: unknown, fallback: ListFilterValue): ListFilterValue {
  const text = queryText(value)
  if (typeof fallback === 'number') {
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  if (typeof fallback === 'boolean') return text === 'true' || text === '1'
  return text || fallback
}

function serializeFilterValue(value: ListFilterValue) {
  if (value === null || value === undefined || value === '') return undefined
  return String(value)
}

/**
 * 标准服务端列表页状态：页码、筛选重置、筛选变化回到第 1 页，以及 URL query 双向同步。
 * 搜索输入仍配合 useDebouncedSearch 使用，请求只读取其 debounced 值。
 */
export function useListPage(options: UseListPageOptions = {}) {
  const route = useRoute()
  const router = useRouter()
  const filters = options.filters || {}
  const syncUrl = options.syncUrl !== false
  const pageSize = Math.max(1, Math.floor(options.pageSize || 20))
  const initialValues = Object.fromEntries(
    Object.entries(filters).map(([key, value]) => [key, value.value])
  ) as Record<string, ListFilterValue>
  const defaults = { ...initialValues, ...options.defaults }
  const initialPage = Math.max(1, Number.parseInt(queryText(route.query.page), 10) || 1)
  const page = ref(initialPage)
  let applyingRoute = false

  function applyRouteQuery() {
    applyingRoute = true
    page.value = Math.max(1, Number.parseInt(queryText(route.query.page), 10) || 1)
    for (const [key, target] of Object.entries(filters)) {
      target.value = route.query[key] === undefined
        ? defaults[key]
        : parseFilterValue(route.query[key], defaults[key])
    }
    applyingRoute = false
  }

  function syncRouteQuery() {
    if (!syncUrl || applyingRoute) return
    const query = { ...route.query }
    if (page.value > 1) query.page = String(page.value)
    else delete query.page

    for (const [key, target] of Object.entries(filters)) {
      const value = serializeFilterValue(target.value)
      if (value === undefined || target.value === defaults[key]) Reflect.deleteProperty(query, key)
      else query[key] = value
    }
    void router.replace({ query })
  }

  function resetPage() {
    page.value = 1
  }

  function resetFilters() {
    applyingRoute = true
    for (const [key, target] of Object.entries(filters)) {
      target.value = defaults[key]
    }
    page.value = 1
    applyingRoute = false
    syncRouteQuery()
  }

  applyRouteQuery()

  if (Object.keys(filters).length > 0) {
    watch(
      Object.values(filters),
      () => {
        if (applyingRoute) return
        page.value = 1
        syncRouteQuery()
      }
    )
  }
  watch(page, syncRouteQuery)
  if (syncUrl) watch(() => route.query, applyRouteQuery)

  return { page, pageSize, resetPage, resetFilters }
}
