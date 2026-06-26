interface RequirementItem {
  id: number
  itemKind: 'baseline' | 'change'
  parentRequirementId: number | null
  changeNo: number | null
  changeReason: string | null
  scopeNote: string | null
  reqNumber: number
  reqCode: string
  title: string
  type: 'functional' | 'non_functional'
  category: string | null
  priority: string
  source: string
  milestoneId: number | null
  milestoneName: string | null
  status: string
  currentVersion: number
  baselinedAt: string | null
  taskItemKey: string | null
  taskStatus: string | null
  contentCount: number
  createdBy: string
  createdAt: string
  updatedAt: string
}

interface RequirementListResponse {
  code: number
  data: {
    items: RequirementItem[]
    total: number
    page: number
    pageSize: number
    statusCounts: Record<string, number>
    baselineSummary: {
      draftCount: number
      baselinedCount: number
      pendingBatchCount: number
    }
  }
}

interface ContentNode {
  id: number
  contentOriginalId: number | null
  versionNo: number
  versionStatus: string
  parentId: number | null
  headingDepth: number
  title: string
  sortOrder: number
  status: string
  requirementId: number | null
  contentMd: string | null
  createdAt: string
}

interface SpecResponse {
  code: number
  data: {
    spec: {
      id: number
      uuid: string
      title: string
      codocsUuid: string | null
      importMode: string | null
      headingLevels: string | null
      importStatus: string | null
    } | null
    contents: ContentNode[]
    requirements: { id: number, reqCode: string, title: string, status: string, createdAt: string }[]
  }
}

export function useRequirements(projectId: Ref<number> | ComputedRef<number>) {
  const items = ref<RequirementItem[]>([])
  const total = ref(0)
  const statusCounts = ref<Record<string, number>>({})
  const baselineSummary = ref({ draftCount: 0, baselinedCount: 0, pendingBatchCount: 0 })
  const loading = ref(false)
  let fetchListRequestId = 0

  const filters = reactive({
    type: 'all' as string,
    status: 'active' as string,
    priority: 'all' as string,
    milestoneId: '' as string,
    source: '' as string,
    workItemId: '' as string,
    search: '' as string,
    page: 1,
    pageSize: 50,
    sort: 'req_number',
    order: 'ASC'
  })

  async function fetchList() {
    const requestId = ++fetchListRequestId
    loading.value = true
    try {
      const query = new URLSearchParams()
      const normalizedSearch = filters.search.trim()
      if (filters.type && filters.type !== 'all') query.set('type', filters.type)
      if (filters.status && filters.status !== 'all') query.set('status', filters.status)
      if (filters.priority && filters.priority !== 'all') query.set('priority', filters.priority)
      if (filters.milestoneId) query.set('milestone_id', filters.milestoneId)
      if (filters.source) query.set('source', filters.source)
      if (filters.workItemId) query.set('work_item_id', filters.workItemId)
      if (normalizedSearch) query.set('search', normalizedSearch)
      query.set('page', String(filters.page))
      query.set('pageSize', String(filters.pageSize))
      query.set('sort', filters.sort)
      query.set('order', filters.order)

      const res = await $fetch<RequirementListResponse>(
        `/api/v1/projects/${projectId.value}/requirements?${query.toString()}`
      )
      if (requestId !== fetchListRequestId) return
      if (res.code === 0) {
        items.value = res.data.items
        total.value = res.data.total
        statusCounts.value = res.data.statusCounts
        baselineSummary.value = res.data.baselineSummary
      }
    } finally {
      if (requestId === fetchListRequestId) {
        loading.value = false
      }
    }
  }

  return { items, total, statusCounts, baselineSummary, loading, filters, fetchList }
}

export function useRequirementSpec(projectId: Ref<number> | ComputedRef<number>) {
  const spec = ref<SpecResponse['data']['spec']>(null)
  const contents = ref<ContentNode[]>([])
  const linkedRequirements = ref<SpecResponse['data']['requirements']>([])
  const loading = ref(false)

  async function fetchSpec(options?: { includeDeleted?: boolean }) {
    loading.value = true
    try {
      const query = new URLSearchParams()
      if (options?.includeDeleted) {
        query.set('include_deleted', '1')
      }
      const res = await $fetch<SpecResponse>(
        `/api/v1/projects/${projectId.value}/requirements/spec${query.toString() ? `?${query.toString()}` : ''}`
      )
      if (res.code === 0) {
        spec.value = res.data.spec
        contents.value = res.data.contents
        linkedRequirements.value = res.data.requirements
      }
    } finally {
      loading.value = false
    }
  }

  const contentTree = computed(() => {
    const map = new Map<number, ContentNode & { children: (ContentNode & { children: unknown[] })[] }>()
    const roots: (ContentNode & { children: (ContentNode & { children: unknown[] })[] })[] = []

    for (const c of contents.value) {
      map.set(c.id, { ...c, children: [] })
    }
    for (const c of contents.value) {
      const node = map.get(c.id)!
      if (c.parentId && map.has(c.parentId)) {
        map.get(c.parentId)!.children.push(node)
      } else {
        roots.push(node)
      }
    }
    return roots
  })

  return { spec, contents, linkedRequirements, loading, fetchSpec, contentTree }
}
