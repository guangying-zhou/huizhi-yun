import type { MaybeRef } from 'vue'
import type { WorkItemType, Priority, Severity } from '~/types/aims'

export interface WorkItemListFilters {
  status: string | undefined
  type: WorkItemType | undefined
  priority: Priority | undefined
  assignee: string | undefined
  severity: Severity | undefined
  milestoneId: number | undefined
}

export interface WorkItemListOptions {
  projectId: MaybeRef<number>
  defaultType?: WorkItemType
  defaultFilters?: Partial<WorkItemListFilters>
}

/**
 * 工作项列表逻辑封装
 * 包含筛选、搜索（防抖）、分页、批量选择、批量更新
 */
export function useWorkItemList(options: WorkItemListOptions) {
  const store = useWorkItemStore()
  const { execute } = useApiRequest()

  const projectId = toRef(options.projectId)

  // ---- 筛选 ----
  const filters = reactive<WorkItemListFilters>({
    status: options.defaultFilters?.status,
    type: options.defaultType ?? options.defaultFilters?.type,
    priority: options.defaultFilters?.priority,
    assignee: options.defaultFilters?.assignee,
    severity: options.defaultFilters?.severity,
    milestoneId: options.defaultFilters?.milestoneId
  })

  // ---- 搜索（防抖 300ms） ----
  const search = ref('')
  const debouncedSearch = ref('')
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  watch(search, (val) => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      debouncedSearch.value = val
    }, 300)
  })

  // ---- 排序 ----
  const sort = reactive({
    field: 'createdAt' as string,
    order: 'desc' as 'asc' | 'desc'
  })

  // ---- 分页 ----
  const pagination = reactive({
    page: 1,
    pageSize: 20
  })

  // ---- 批量选择 ----
  const selectedIds = ref<number[]>([])

  const selectAll = computed({
    get: () => {
      if (store.items.length === 0) return false
      return store.items.every(item => selectedIds.value.includes(item.id))
    },
    set: (val: boolean) => {
      selectedIds.value = val ? store.items.map(item => item.id) : []
    }
  })

  function toggleSelect(id: number) {
    const idx = selectedIds.value.indexOf(id)
    if (idx === -1) {
      selectedIds.value.push(id)
    } else {
      selectedIds.value.splice(idx, 1)
    }
  }

  // ---- 数据加载 ----
  const items = computed(() => store.items)
  const loading = computed(() => store.loading)
  const error = ref<Error | null>(null)

  async function refresh() {
    error.value = null
    try {
      await store.fetchItems(projectId.value, {
        type: filters.type,
        status: filters.status,
        priority: filters.priority,
        severity: filters.severity,
        assigneeUid: filters.assignee,
        milestoneId: filters.milestoneId,
        search: debouncedSearch.value || undefined,
        page: pagination.page,
        pageSize: pagination.pageSize
      })
    } catch (err: unknown) {
      error.value = err instanceof Error ? err : new Error(String(err))
    }
  }

  // 筛选/搜索/分页变化时自动刷新
  watch(
    [
      () => filters.status,
      () => filters.type,
      () => filters.priority,
      () => filters.assignee,
      () => filters.severity,
      () => filters.milestoneId,
      debouncedSearch,
      () => pagination.page,
      () => pagination.pageSize
    ],
    () => {
      // 筛选变化时回到第一页（分页自身变化除外）
      refresh()
    }
  )

  // projectId 变化时重置并刷新
  watch(projectId, () => {
    pagination.page = 1
    selectedIds.value = []
    refresh()
  })

  // ---- 批量更新 ----
  async function batchUpdate(changes: Record<string, unknown>) {
    if (selectedIds.value.length === 0) return

    await execute(() => store.batchUpdate(selectedIds.value, changes))
    selectedIds.value = []
    await refresh()
  }

  return {
    items,
    loading,
    error,
    filters,
    search,
    sort,
    pagination,
    selectedIds,
    selectAll,
    toggleSelect,
    batchUpdate,
    refresh
  }
}
