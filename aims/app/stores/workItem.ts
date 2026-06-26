import { defineStore } from 'pinia'
import type {
  WorkItem,
  WorkItemDetail,
  WorkItemComment,
  CreateWorkItemRequest,
  UpdateWorkItemRequest,
  WorkItemListQuery,
  PaginatedList
} from '~/types/aims'

type RawWorkItem = Partial<WorkItem> & Record<string, unknown>

function nullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function nullableString(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return String(value)
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true'
  return false
}

function normalizeWorkItem(raw: RawWorkItem): WorkItem {
  const projectId = Number(raw.projectId ?? raw.project_id) || 0
  return {
    id: Number(raw.id) || 0,
    projectId,
    milestoneId: Number(raw.milestoneId ?? raw.milestone_id) || 0,
    itemNumber: Number(raw.itemNumber ?? raw.item_number) || 0,
    itemKey: String(raw.itemKey ?? raw.item_key ?? ''),
    type: (raw.type || 'task') as WorkItem['type'],
    tier: (raw.tier || 'target') as WorkItem['tier'],
    title: String(raw.title || ''),
    description: nullableString(raw.description),
    startDate: nullableString(raw.startDate ?? raw.start_date),
    status: String(raw.status || 'planning'),
    priority: (raw.priority || 'P2') as WorkItem['priority'],
    severity: nullableString(raw.severity) as WorkItem['severity'],
    weight: Number(raw.weight) || 0,
    assigneeUid: nullableString(raw.assigneeUid ?? raw.assignee_uid),
    reporterUid: nullableString(raw.reporterUid ?? raw.reporter_uid),
    dueDate: nullableString(raw.dueDate ?? raw.due_date),
    estimatedHours: nullableNumber(raw.estimatedHours ?? raw.estimated_hours),
    parentId: nullableNumber(raw.parentId ?? raw.parent_id),
    versionId: nullableNumber(raw.versionId ?? raw.version_id),
    featureId: nullableNumber(raw.featureId ?? raw.feature_id),
    sortOrder: Number(raw.sortOrder ?? raw.sort_order) || 0,
    required: booleanValue(raw.required),
    templateKey: nullableString(raw.templateKey ?? raw.template_key),
    approvalStatus: (raw.approvalStatus ?? raw.approval_status ?? 'not_required') as WorkItem['approvalStatus'],
    workflowInstanceId: nullableString(raw.workflowInstanceId ?? raw.workflow_instance_id),
    createdAt: String(raw.createdAt ?? raw.created_at ?? ''),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? ''),
    assigneeName: nullableString(raw.assigneeName ?? raw.assignee_name) || undefined,
    reporterName: nullableString(raw.reporterName ?? raw.reporter_name) || undefined,
    milestoneName: nullableString(raw.milestoneName ?? raw.milestone_name) || undefined,
    versionCode: nullableString(raw.versionCode ?? raw.version_code),
    featureTitle: nullableString(raw.featureTitle ?? raw.feature_title)
  }
}

function normalizeWorkItemList(data: unknown): WorkItem[] {
  if (Array.isArray(data)) return data.map(item => normalizeWorkItem(item as RawWorkItem))
  if (data && typeof data === 'object') {
    const value = data as { items?: unknown, data?: unknown }
    if (Array.isArray(value.items)) return value.items.map(item => normalizeWorkItem(item as RawWorkItem))
    if (Array.isArray(value.data)) return value.data.map(item => normalizeWorkItem(item as RawWorkItem))
  }
  return []
}

function groupWorkItemsByStatus(items: WorkItem[]) {
  const grouped: Record<string, WorkItem[]> = {}
  for (const item of items) {
    if (!grouped[item.status]) grouped[item.status] = []
    grouped[item.status]!.push(item)
  }
  return grouped
}

export const useWorkItemStore = defineStore('workItem', () => {
  // ---- State ----
  const items = ref<WorkItem[]>([])
  const total = ref(0)
  const currentItem = ref<WorkItemDetail | null>(null)
  const loading = ref(false)

  // 看板分组数据（按 status 分组）
  const boardColumns = ref<Record<string, WorkItem[]>>({})

  // ---- Actions ----
  async function fetchItems(projectId: number, query?: WorkItemListQuery) {
    loading.value = true
    try {
      const params = new URLSearchParams()
      if (query?.type) params.set('type', query.type)
      if (query?.status) params.set('status', query.status)
      if (query?.milestoneId) params.set('milestoneId', String(query.milestoneId))
      if (query?.assigneeUid) params.set('assignee_uid', query.assigneeUid)
      if (query?.priority) params.set('priority', query.priority)
      if (query?.versionId) params.set('version_id', String(query.versionId))
      if (query?.search) params.set('search', query.search)
      if (query?.page) params.set('page', String(query.page))
      if (query?.pageSize) params.set('page_size', String(query.pageSize))

      const res = await $fetch<{ code: number, data: PaginatedList<WorkItem> | unknown }>(
        `/api/v1/projects/${projectId}/work-items?${params.toString()}`
      )
      if (res.code === 0) {
        items.value = normalizeWorkItemList(res.data)
        total.value = Number((res.data as PaginatedList<WorkItem>)?.total) || items.value.length
      }
    } finally {
      loading.value = false
    }
  }

  async function fetchBoardItems(projectId: number, opts?: { milestoneId?: number, type?: string, tier?: string, versionId?: number }) {
    loading.value = true
    try {
      const params = new URLSearchParams({ view: 'board' })
      if (opts?.milestoneId) params.set('milestoneId', String(opts.milestoneId))
      if (opts?.type) params.set('type', opts.type)
      if (opts?.tier) params.set('tier', opts.tier)
      if (opts?.versionId) params.set('version_id', String(opts.versionId))

      const res = await $fetch<{ code: number, data: Record<string, WorkItem[]> | PaginatedList<WorkItem> | unknown }>(
        `/api/v1/projects/${projectId}/work-items?${params.toString()}`
      )
      if (res.code === 0) {
        if (res.data && typeof res.data === 'object' && Array.isArray((res.data as { items?: unknown }).items)) {
          boardColumns.value = groupWorkItemsByStatus(normalizeWorkItemList(res.data))
        } else if (res.data && typeof res.data === 'object') {
          const grouped: Record<string, WorkItem[]> = {}
          for (const [status, value] of Object.entries(res.data as Record<string, unknown>)) {
            grouped[status] = normalizeWorkItemList(value)
          }
          boardColumns.value = grouped
        } else {
          boardColumns.value = {}
        }
      }
    } catch (err) {
      console.error('[WorkItemStore] fetchBoardItems failed:', err)
      boardColumns.value = {}
    } finally {
      loading.value = false
    }
  }

  async function fetchItem(id: number) {
    loading.value = true
    try {
      const res = await $fetch<{ code: number, data: WorkItemDetail }>(
        `/api/v1/work-items/${id}`
      )
      if (res.code === 0) {
        currentItem.value = res.data
      }
    } finally {
      loading.value = false
    }
  }

  async function createItem(projectId: number, data: CreateWorkItemRequest) {
    const res = await $fetch<{ code: number, data: WorkItem }>(
      `/api/v1/projects/${projectId}/work-items`,
      { method: 'POST', body: data }
    )
    if (res.code === 0) {
      const item = normalizeWorkItem(res.data as RawWorkItem)
      items.value.unshift(item)
      total.value++
      return item
    }
    return normalizeWorkItem(res.data as RawWorkItem)
  }

  async function updateItem(id: number, data: UpdateWorkItemRequest) {
    const res = await $fetch<{ code: number, data: WorkItem }>(
      `/api/v1/work-items/${id}`,
      { method: 'PUT', body: data }
    )
    if (res.code === 0) {
      const item = normalizeWorkItem(res.data as RawWorkItem)
      const idx = items.value.findIndex(i => i.id === id)
      if (idx !== -1) items.value[idx] = item
      if (currentItem.value?.id === id) {
        Object.assign(currentItem.value, item)
      }
      return item
    }
    return normalizeWorkItem(res.data as RawWorkItem)
  }

  async function deleteItem(id: number) {
    await $fetch(`/api/v1/work-items/${id}`, { method: 'DELETE' })
    items.value = items.value.filter(i => i.id !== id)
    total.value--
    if (currentItem.value?.id === id) {
      currentItem.value = null
    }
  }

  async function batchUpdate(ids: number[], changes: Record<string, unknown>) {
    const res = await $fetch<{ code: number, data: { updated: number } }>(
      '/api/v1/work-items/batch',
      { method: 'PATCH', body: { ids, changes } }
    )
    return res.data
  }

  // ---- Comments ----
  async function addComment(workItemId: number, content: string) {
    const res = await $fetch<{ code: number, data: WorkItemComment }>(
      `/api/v1/work-items/${workItemId}/comments`,
      { method: 'POST', body: { content } }
    )
    if (res.code === 0 && currentItem.value?.id === workItemId) {
      if (!currentItem.value.comments) currentItem.value.comments = []
      currentItem.value.comments.push(res.data)
    }
    return res.data
  }

  return {
    items,
    total,
    currentItem,
    loading,
    boardColumns,
    fetchItems,
    fetchBoardItems,
    fetchItem,
    createItem,
    updateItem,
    deleteItem,
    batchUpdate,
    addComment
  }
})
