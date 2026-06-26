<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { WorkItem, WorkItemType, Priority, Severity, CreateWorkItemRequest, WorkItemListQuery } from '~/types/aims'
import {
  typeConfig,
  priorityConfig,
  severityConfig,
  getStatusLabel,
  getStatusColor,
  transitionLabels
} from '~/config/work-item'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '目标',
  layoutHeaderProjectSwitcher: true
})

const route = useRoute()
const projectId = computed(() => Number(route.params.id))
const childRouteActive = computed(() => Boolean(route.params.workItemId))

const projectStore = useProjectStore()
const { isWorkItemEditable, canEditTargetStructure, workItemReadonlyReason } = storeToRefs(projectStore)
const { user: currentUserUid } = useAuth()
const workItemStore = useWorkItemStore()
const milestoneStore = useMilestoneStore()
const toast = useToast()
const { users: accountUsers } = useAccountUsers()
const { isApprovalMode } = useApprovalMode()

const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const u of accountUsers.value) {
    if (u.realName?.trim()) map.set(u.uid, u.realName.trim())
  }
  return map
})

function getUserName(uid: string | null | undefined) {
  if (!uid) return '未指派'
  return userNameMap.value.get(uid) || uid
}

function mapCompletionWorkflowStatusToWorkItemStatus(status: string): 'in_review' | 'completed' | 'in_progress' | null {
  if (status === 'running') return 'in_review'
  if (status === 'approved') return 'completed'
  if (status === 'rejected') return 'in_progress'
  return null
}

async function reconcileCompletionReviewStatuses(items: WorkItem[]): Promise<number> {
  const candidates = items.filter(item =>
    item.tier === 'target'
    && ['in_progress', 'in_review'].includes(item.status)
  )
  if (candidates.length === 0) return 0

  const results = await Promise.all(candidates.map(async (item) => {
    try {
      const wfRes = await fetchInstanceByBiz({
        app_code: 'aims',
        resource_code: 'tasks',
        biz_id: String(item.id),
        action_code: 'complete',
        include_history: true
      })
      const wfStatus = wfRes.data?.status
      if (!wfStatus) return false

      const nextStatus = mapCompletionWorkflowStatusToWorkItemStatus(wfStatus)
      if (!nextStatus || nextStatus === item.status) return false

      await $fetch(`/api/v1/work-items/${item.id}`, {
        method: 'PUT',
        body: { status: nextStatus }
      })
      return true
    } catch {
      return false
    }
  }))

  return results.filter(Boolean).length
}

const isCurrentUserProjectMember = computed(() => {
  const uid = currentUserUid.value?.trim()
  if (!uid) return false

  return (projectStore.currentProject?.members || []).some((member) => {
    return member.uid === uid && member.status !== 'suspended'
  })
})

const memberOptions = computed(() => {
  const members = (projectStore.currentProject?.members || []).filter(m => m.status !== 'suspended')
  return members.map((m) => {
    const name = m.realName || userNameMap.value.get(m.uid) || ''
    return {
      label: name ? `${name}(${m.uid})` : m.uid,
      value: m.uid
    }
  })
})

interface WorkItemVersionOption {
  id: number
  productCode: string
  productName: string | null
  versionCode: string
  versionName: string | null
  status: string
}

// 视图模式
const viewMode = ref<'board' | 'list'>('board')

// 里程碑页签
const activeMilestoneId = ref<string>('all')
const milestonesTabs = computed(() => {
  const tabs: { label: string, value: string, status?: string }[] = [{ label: '全部', value: 'all' }]
  for (const m of milestoneStore.milestones) {
    tabs.push({ label: m.name, value: String(m.id), status: m.status })
  }
  return tabs
})

// 当前选中里程碑是否已完成
const activeMilestoneCompleted = computed(() => {
  if (activeMilestoneId.value === 'all' || activeMilestoneId.value === 'none') return false
  const m = milestoneStore.milestones.find(ms => String(ms.id) === activeMilestoneId.value)
  return m?.status === 'completed'
})

const canCreateWorkItem = computed(() => {
  return canEditTargetStructure.value && isCurrentUserProjectMember.value && !activeMilestoneCompleted.value
})

// 类型 Tab
const activeTab = ref<string>('all')
const typeTabs = [
  { label: '全部', value: 'all' },
  { label: '需求', value: 'requirement' },
  { label: '综合任务', value: 'task' },
  { label: '重大缺陷', value: 'bug' }
]

// 筛选（列表视图）
const filterStatus = ref<string>('all')
const filterAssignee = ref<string>('')
const filterPriority = ref<string>('all')
const filterSeverity = ref<string>('all')
const filterVersionId = ref<string>('all')
const searchText = ref('')

const versionOptions = ref<WorkItemVersionOption[]>([])

// 新建弹窗
const showCreateModal = ref(false)
const creating = ref(false)

// 新建表单
const createForm = ref<CreateWorkItemRequest>({
  type: 'task',
  tier: 'target',
  title: '',
  milestoneId: 0,
  description: '',
  priority: 'P1',
  severity: 'medium',
  assigneeUid: '',
  dueDate: '',
  versionId: null,
  featureId: null
})

// 详情侧边栏（列表视图）
const showDetail = ref(false)
const selectedItemId = ref<number | null>(null)

// 批量操作（列表视图）
const selectedIds = ref<number[]>([])
const showBatchBar = computed(() => selectedIds.value.length > 0)

// ========================
// 看板相关
// ========================
const swimlaneMode = ref<'none' | 'assignee' | 'priority'>('none')

const showBoardDetail = ref(false)
const selectedItem = ref<WorkItem | null>(null)
const availableTransitions = ref<{ toStatus: string, transitionKey: string }[]>([])
const transitioning = ref(false)

let pointerStart = { x: 0, y: 0 }
let isDragging = false
let suppressClickUntil = 0
let dragCleanupTimer: ReturnType<typeof setTimeout> | null = null

const dragState = ref<{ item: WorkItem, fromColKey: string } | null>(null)
const dragOverColumnKey = ref<string | null>(null)
const dragAllowedTargets = ref<string[]>([])
const dragBlockedReasons = ref<Record<string, string>>({})
const dragValidationState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
let dragValidationToken = 0

function onCardPointerDown(e: PointerEvent) {
  pointerStart = { x: e.clientX, y: e.clientY }
  isDragging = false
}

function onCardClick(e: MouseEvent, item: WorkItem) {
  if (isDragging || Date.now() < suppressClickUntil) return
  const dx = Math.abs(e.clientX - pointerStart.x)
  const dy = Math.abs(e.clientY - pointerStart.y)
  if (dx > 5 || dy > 5) return
  openBoardDetail(item)
}

const wipLimits = ref<Record<string, number>>({
  planning: 0,
  todo: 0,
  in_progress: 5,
  in_review: 3,
  completed: 0
})

// 看板列定义
const boardColumns = [
  { key: 'planning', label: '目标规划', color: 'neutral' },
  { key: 'todo', label: '任务分解', color: 'info' },
  { key: 'in_progress', label: '执行中', color: 'primary' },
  { key: 'in_review', label: '确认中', color: 'warning' },
  { key: 'completed', label: '已完成', color: 'success' }
]

const columnData = ref<Record<string, WorkItem[]>>({})
const columnValueRefs: Record<string, Ref<WorkItem[]>> = {}
for (const col of boardColumns) {
  columnValueRefs[col.key] = ref<WorkItem[]>([])
}
const boardMounted = ref(false)

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '目标规划', value: 'planning' },
  { label: '任务分解', value: 'todo' },
  { label: '执行中', value: 'in_progress' },
  { label: '确认中', value: 'in_review' },
  { label: '已完成', value: 'completed' }
]

const filterPriorityOptions = [
  { label: '全部优先级', value: 'all' },
  { label: 'P0 - 紧急', value: 'P0' },
  { label: 'P1 - 高', value: 'P1' },
  { label: 'P2 - 中', value: 'P2' },
  { label: 'P3 - 低', value: 'P3' }
]

const filterSeverityOptions = [
  { label: '全部严重程度', value: 'all' },
  { label: '致命', value: 'critical' },
  { label: '严重', value: 'high' },
  { label: '一般', value: 'medium' },
  { label: '轻微', value: 'low' },
  { label: '建议', value: 'suggestion' }
]

const versionFilterOptions = computed(() => [
  { label: '全部版本', value: 'all' },
  { label: '未关联版本', value: 'none' },
  ...versionOptions.value.map(version => ({
    label: `${version.productCode} / ${version.versionCode}`,
    value: String(version.id)
  }))
])

const createVersionOptions = computed(() => [
  { label: '不关联版本', value: 0 },
  ...versionOptions.value
    .filter(version => ['planning', 'developing'].includes(version.status))
    .map(version => ({
      label: `${version.productCode} / ${version.versionCode}`,
      value: version.id
    }))
])

function versionLabel(versionId: number | null | undefined) {
  if (!versionId) return '-'
  const version = versionOptions.value.find(item => item.id === versionId)
  return version ? `${version.productCode} / ${version.versionCode}` : `#${versionId}`
}

async function loadVersions() {
  try {
    const res = await $fetch<{ code: number, data: { items?: any[] } }>(`/api/v1/projects/${projectId.value}/releases`)
    versionOptions.value = (res.data.items || []).map(item => ({
      id: Number(item.id) || 0,
      productCode: String(item.product_code || item.productCode || ''),
      productName: item.product_name || item.productName || null,
      versionCode: String(item.version_code || item.versionCode || ''),
      versionName: item.name || item.version_name || item.versionName || null,
      status: String(item.status || '')
    })).filter(item => item.id > 0 && item.productCode && item.versionCode)
  } catch {
    versionOptions.value = []
  }
}

const transitionColor: Record<string, string> = {
  start: 'primary',
  submit_review: 'info',
  approve_review: 'success',
  pass_test: 'success',
  confirm: 'info',
  start_fix: 'primary',
  submit_verify: 'info',
  pass_verify: 'success',
  reject_review: 'warning',
  reopen: 'warning',
  fail_verify: 'warning',
  reject: 'error'
}

const columnColorClass: Record<string, string> = {
  neutral: 'border-neutral-300 dark:border-neutral-600',
  primary: 'border-primary',
  info: 'border-info',
  warning: 'border-warning',
  success: 'border-success'
}

// 是否显示严重程度列（列表视图）
const showSeverity = computed(() => activeTab.value === 'bug')

const columns = computed(() => {
  const base = [
    { accessorKey: 'select', header: '' },
    { accessorKey: 'itemKey', header: '编号' },
    { accessorKey: 'type', header: '类型' },
    { accessorKey: 'title', header: '标题' },
    { accessorKey: 'status', header: '状态' },
    { accessorKey: 'priority', header: '优先级' }
  ]
  if (showSeverity.value) {
    base.push({ accessorKey: 'severity', header: '严重程度' })
  }
  base.push(
    { accessorKey: 'versionId', header: '版本' },
    { accessorKey: 'assigneeUid', header: '指派人' },
    { accessorKey: 'dueDate', header: '截止日期' }
  )
  return base
})

const milestoneSelectOptions = computed(() =>
  milestoneStore.milestones
    .filter(m => m.status !== 'completed')
    .map(m => ({
      label: m.name,
      value: m.id
    }))
)

// 当前"新建工作目标"弹窗选中的里程碑（用于判断 P 阶段限制）
const createFormMilestone = computed(() =>
  milestoneStore.milestones.find(m => m.id === createForm.value.milestoneId) || null
)
const createFormIsPlanningStage = computed(() =>
  createFormMilestone.value?.pivrStage === 'P'
)
// 规则：P 阶段禁止添加"需求类"工作目标
const createTypeOptions = computed(() => {
  const base = [
    { label: '任务', value: 'task' },
    { label: '需求', value: 'requirement' },
    { label: '缺陷', value: 'bug' }
  ]
  if (createFormIsPlanningStage.value) {
    return base.filter(opt => opt.value === 'task')
  }
  return base
})

// 切换到 P 阶段里程碑或弹窗刚打开时，若当前类型不在允许范围内则回退到 task
watch([() => createForm.value.milestoneId, showCreateModal], () => {
  if (!showCreateModal.value) return
  if (createFormIsPlanningStage.value && createForm.value.type === 'requirement') {
    createForm.value.type = 'task'
  }
})

// 层级选项（根据类型动态变化）
const tierOptionsForType = computed(() => {
  const t = createForm.value.type
  if (t === 'requirement') {
    return [
      { label: '复杂需求待分解', value: 'target' },
      { label: '简单需求直接指派', value: 'matter' }
    ]
  }
  if (t === 'bug') {
    return [
      { label: '跨模块缺陷待分解', value: 'target' },
      { label: '简单缺陷直接指派', value: 'matter' }
    ]
  }
  return [
    { label: '综合任务待切分', value: 'target' },
    { label: '简单任务直接指派', value: 'matter' }
  ]
})

// 类型切换时重置 tier 为 target
watch(() => createForm.value.type, () => {
  createForm.value.tier = 'target'
  createForm.value.assigneeUid = ''
})

watch(() => createForm.value.tier, () => {
  if (createForm.value.tier !== 'target') {
    createForm.value.versionId = null
    createForm.value.featureId = null
  }
})

// ========================
// 列表视图逻辑
// ========================
async function loadItems() {
  const typeFilter = activeTab.value === 'all'
    ? undefined
    : activeTab.value as WorkItemType
  const versionId: WorkItemListQuery['versionId'] = filterVersionId.value === 'none'
    ? '__null__'
    : filterVersionId.value !== 'all' ? Number(filterVersionId.value) : undefined
  const query: WorkItemListQuery = {
    type: typeFilter,
    status: filterStatus.value !== 'all' ? filterStatus.value : undefined,
    assigneeUid: filterAssignee.value || undefined,
    priority: (filterPriority.value !== 'all' ? filterPriority.value : undefined) as Priority | undefined,
    severity: (activeTab.value === 'bug' && filterSeverity.value !== 'all' ? filterSeverity.value : undefined) as Severity | undefined,
    versionId,
    search: searchText.value || undefined
  }

  await workItemStore.fetchItems(projectId.value, query)

  const reconciledCount = await reconcileCompletionReviewStatuses(workItemStore.items)
  if (reconciledCount > 0) {
    await workItemStore.fetchItems(projectId.value, query)
  }
}

// 根据里程碑过滤列表数据
const filteredItems = computed(() => {
  if (activeMilestoneId.value === 'all') return workItemStore.items
  if (activeMilestoneId.value === 'none') {
    return workItemStore.items.filter(item => !item.milestoneId)
  }
  const mid = Number(activeMilestoneId.value)
  return workItemStore.items.filter(item => item.milestoneId === mid)
})

// ========================
// 看板视图逻辑
// ========================
const swimlanes = computed(() => {
  if (swimlaneMode.value === 'none') return null
  const allItems = Object.values(columnData.value).flat()
  const groups = new Map<string, string>()
  if (swimlaneMode.value === 'assignee') {
    for (const item of allItems) {
      const key = item.assigneeUid || '__unassigned__'
      if (!groups.has(key)) {
        groups.set(key, getUserName(item.assigneeUid))
      }
    }
  } else if (swimlaneMode.value === 'priority') {
    for (const p of ['P0', 'P1', 'P2', 'P3']) {
      if (allItems.some(i => i.priority === p)) {
        groups.set(p, p)
      }
    }
  }
  return Array.from(groups.entries()).map(([key, label]) => ({ key, label }))
})

function getSwimlanColumnItems(colKey: string, swimlaneKey: string): WorkItem[] {
  const items = columnData.value[colKey] || []
  if (swimlaneMode.value === 'assignee') {
    if (swimlaneKey === '__unassigned__') return items.filter(i => !i.assigneeUid)
    return items.filter(i => i.assigneeUid === swimlaneKey)
  }
  if (swimlaneMode.value === 'priority') {
    return items.filter(i => i.priority === swimlaneKey)
  }
  return items
}

function isWipExceeded(colKey: string): boolean {
  const limit = wipLimits.value[colKey]
  if (!limit) return false
  return (columnValueRefs[colKey]?.value?.length || 0) > limit
}

async function loadBoard() {
  const typeFilter = activeTab.value === 'all' ? undefined : activeTab.value
  const boardQuery = { type: typeFilter }

  await workItemStore.fetchBoardItems(projectId.value, boardQuery)

  const reconciledCount = await reconcileCompletionReviewStatuses(
    Object.values(workItemStore.boardColumns).flat()
  )
  if (reconciledCount > 0) {
    await workItemStore.fetchBoardItems(projectId.value, boardQuery)
  }

  const data: Record<string, WorkItem[]> = {}
  for (const col of boardColumns) {
    let items = workItemStore.boardColumns[col.key] || []
    // 里程碑筛选
    if (activeMilestoneId.value !== 'all') {
      if (activeMilestoneId.value === 'none') {
        items = items.filter(item => !item.milestoneId)
      } else {
        const mid = Number(activeMilestoneId.value)
        items = items.filter(item => item.milestoneId === mid)
      }
    }
    data[col.key] = items
    columnValueRefs[col.key]!.value = [...items]
  }
  columnData.value = data
}

async function refreshCurrentView() {
  if (viewMode.value === 'list') {
    await loadItems()
  } else {
    await loadBoard()
  }
}

function clearDragState(_reason = 'reset') {
  if (dragCleanupTimer) {
    clearTimeout(dragCleanupTimer)
    dragCleanupTimer = null
  }
  dragState.value = null
  dragOverColumnKey.value = null
  dragAllowedTargets.value = []
  dragBlockedReasons.value = {}
  dragValidationState.value = 'idle'
  dragValidationToken++
  suppressClickUntil = Date.now() + 150
  setTimeout(() => {
    isDragging = false
  }, 0)
}

function buildDragBlockedReasons(item: WorkItem, fromColKey: string, allowedTargets: string[]) {
  const nextReasons: Record<string, string> = {}
  for (const col of boardColumns) {
    if (col.key === fromColKey) {
      nextReasons[col.key] = '当前列'
      continue
    }
    const limit = wipLimits.value[col.key]
    const count = columnValueRefs[col.key]?.value.length || 0
    if (limit && count >= limit) {
      nextReasons[col.key] = 'WIP 已满'
      continue
    }
    if (!allowedTargets.includes(col.key)) {
      nextReasons[col.key] = `不能从${getStatusLabel(item.status)}直接流转`
    }
  }
  return nextReasons
}

function isDropAllowed(colKey: string) {
  if (!dragState.value) return false
  return !dragBlockedReasons.value[colKey]
}

function getColumnDragHint(colKey: string) {
  if (!dragState.value) return ''
  if (colKey === dragState.value.fromColKey) return '当前列'
  if (dragValidationState.value === 'loading') return '校验中...'
  return dragBlockedReasons.value[colKey] || '可拖入'
}

async function prefetchDropValidation(item: WorkItem, fromColKey: string) {
  const token = ++dragValidationToken
  dragValidationState.value = 'loading'
  dragAllowedTargets.value = []
  dragBlockedReasons.value = {}
  try {
    const res = await $fetch<{ code: number, data: { toStatus: string, transitionKey: string }[] }>(
      `/api/v1/work-items/${item.id}/transitions`
    )
    if (token !== dragValidationToken || !dragState.value || dragState.value.item.id !== item.id) return
    const allowedTargets = res.code === 0 ? res.data.map(t => t.toStatus) : []
    dragAllowedTargets.value = allowedTargets
    dragBlockedReasons.value = buildDragBlockedReasons(item, fromColKey, allowedTargets)
    dragValidationState.value = 'ready'
  } catch {
    if (token !== dragValidationToken || !dragState.value || dragState.value.item.id !== item.id) return
    dragAllowedTargets.value = []
    dragBlockedReasons.value = Object.fromEntries(
      boardColumns
        .filter(col => col.key !== fromColKey)
        .map(col => [col.key, '状态校验失败'])
    )
    dragValidationState.value = 'error'
  }
}

function onCardDragStart(colKey: string, item: WorkItem, e: DragEvent) {
  if (dragCleanupTimer) {
    clearTimeout(dragCleanupTimer)
    dragCleanupTimer = null
  }
  dragState.value = { item, fromColKey: colKey }
  dragOverColumnKey.value = colKey
  isDragging = true
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.dropEffect = 'move'
    e.dataTransfer.setData('text/plain', String(item.id))
  }
  void prefetchDropValidation(item, colKey)
}

function onCardDragEnd() {
  dragCleanupTimer = setTimeout(() => {
    clearDragState('dragend-timeout')
  }, 120)
}

function onColumnDragOver(colKey: string, e: DragEvent) {
  if (!dragState.value) return
  e.preventDefault()
  const previousColKey = dragOverColumnKey.value
  dragOverColumnKey.value = colKey
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = isDropAllowed(colKey) ? 'move' : 'none'
  }
  if (previousColKey !== colKey) return
}

function onColumnDragEnter(colKey: string, e: DragEvent) {
  if (!dragState.value) return
  e.preventDefault()
  if (dragOverColumnKey.value !== colKey) {
    dragOverColumnKey.value = colKey
  }
}

function onColumnDragLeave(colKey: string, e: DragEvent) {
  const relatedTarget = e.relatedTarget
  if (relatedTarget instanceof Node && (e.currentTarget as HTMLElement | null)?.contains(relatedTarget)) {
    return
  }
  if (dragOverColumnKey.value === colKey) {
    dragOverColumnKey.value = null
  }
}

function findDragSourceByItemId(itemId: number) {
  for (const col of boardColumns) {
    const item = columnValueRefs[col.key]?.value.find(candidate => candidate.id === itemId)
    if (item) {
      return { item, fromColKey: col.key }
    }
  }
  return null
}

// 从目标规划拖到任务分解前的完整性校验
async function validatePlanningToTodo(item: WorkItem): Promise<{ ok: boolean, issues: string[] }> {
  const issues: string[] = []
  if (!item.estimatedHours) issues.push('缺少控制工时')
  if (!item.startDate) issues.push('缺少开始日期')
  if (!item.dueDate) issues.push('缺少结束日期')
  if (item.startDate && item.dueDate && new Date(item.startDate) > new Date(item.dueDate)) {
    issues.push('起止日期不合法')
  }
  // 成果要求必须至少 1 条
  try {
    const res = await $fetch<{ code: number, data: { id: number }[] }>(
      '/api/v1/deliverables',
      { params: { entity_type: 'work_item', entity_id: item.id } }
    )
    if (res.code === 0 && res.data.length === 0) {
      issues.push('至少需要 1 条成果要求')
    }
  } catch {
    issues.push('无法加载成果要求')
  }
  return { ok: issues.length === 0, issues }
}

async function onColumnDrop(colKey: string, e: DragEvent) {
  if (dragCleanupTimer) {
    clearTimeout(dragCleanupTimer)
    dragCleanupTimer = null
  }
  const draggedItemId = Number(e.dataTransfer?.getData('text/plain') || 0)
  const currentDrag = dragState.value || (draggedItemId ? findDragSourceByItemId(draggedItemId) : null)
  const validationState = dragValidationState.value
  const blockedReason = dragBlockedReasons.value[colKey]

  if (!currentDrag || currentDrag.fromColKey === colKey) {
    return
  }
  const { item, fromColKey } = currentDrag
  if (validationState === 'loading') {
    toast.add({
      title: '正在校验拖拽目标',
      description: '请稍后重试拖拽',
      color: 'warning',
      icon: 'i-lucide-loader-2'
    })
    clearDragState('validation-loading')
    return
  }
  if (blockedReason) {
    toast.add({
      title: blockedReason === 'WIP 已满' ? 'WIP 已超限' : '不能拖到该列',
      description: blockedReason === 'WIP 已满'
        ? `${boardColumns.find(col => col.key === colKey)?.label || colKey} 已达到上限`
        : blockedReason,
      color: 'warning',
      icon: blockedReason === 'WIP 已满' ? 'i-lucide-alert-triangle' : 'i-lucide-git-pull-request-draft'
    })
    clearDragState('blocked-reason')
    return
  }

  // 业务校验：planning → todo 要求目标信息完整且至少 1 条成果要求
  if (fromColKey === 'planning' && colKey === 'todo') {
    const validation = await validatePlanningToTodo(item)
    if (!validation.ok) {
      toast.add({
        title: '目标信息不完整',
        description: validation.issues.join('；'),
        color: 'warning',
        icon: 'i-lucide-alert-triangle'
      })
      clearDragState('planning-incomplete')
      return
    }
  }

  const targetItems = columnValueRefs[colKey]?.value || []
  const sourceItems = columnValueRefs[fromColKey]?.value || []
  const nextSourceItems = sourceItems.filter(sourceItem => sourceItem.id !== item.id)
  const nextTargetItems = [...targetItems, item]
  columnValueRefs[fromColKey]!.value = nextSourceItems
  columnValueRefs[colKey]!.value = nextTargetItems
  columnData.value[fromColKey] = nextSourceItems
  columnData.value[colKey] = nextTargetItems

  try {
    await workItemStore.updateItem(item.id, { status: colKey })
    await loadBoard()
  } catch (err: unknown) {
    await loadBoard()
    const errData = (err as { data?: { message?: string }, statusMessage?: string, message?: string }) || {}
    const serverMsg = errData.data?.message || errData.statusMessage || errData.message
    toast.add({
      title: '无法变更状态',
      description: serverMsg || '状态更新未成功，已恢复原位置',
      color: 'error',
      icon: 'i-lucide-circle-x'
    })
  } finally {
    clearDragState('drop-finished')
  }
}

// ========================
// 工时记录（共用）
// ========================
const showTimeEntry = ref(false)
const savingTimeEntry = ref(false)
const timeEntries = ref<{ id: number, entryDate: string, uid: string, hours: number, description: string }[]>([])
const timeEntryForm = ref({
  entryDate: new Date().toISOString().slice(0, 10),
  hours: '',
  description: ''
})

async function loadTimeEntries(itemId: number) {
  try {
    const res = await $fetch<{ code: number, data: any[] }>(`/api/v1/work-items/${itemId}/time-entries`)
    if (res.code === 0) {
      timeEntries.value = res.data
    }
  } catch {
    timeEntries.value = []
  }
}

async function saveTimeEntry() {
  const targetId = viewMode.value === 'board' ? selectedItem.value?.id : selectedItemId.value
  if (!targetId) return
  savingTimeEntry.value = true
  try {
    await $fetch(`/api/v1/work-items/${targetId}/time-entries`, {
      method: 'POST',
      body: timeEntryForm.value
    })
    showTimeEntry.value = false
    timeEntryForm.value = {
      entryDate: new Date().toISOString().slice(0, 10),
      hours: '',
      description: ''
    }
    await loadTimeEntries(targetId)
  } finally {
    savingTimeEntry.value = false
  }
}

// ========================
// 关联文档（共用）
// ========================
const showLinkDoc = ref(false)
const docIdToLink = ref('')
const linkedDocs = ref<{ id: number, documentId: string }[]>([])

async function loadLinkedDocs(itemId: number) {
  try {
    const res = await $fetch<{ code: number, data: any[] }>(`/api/v1/work-items/${itemId}/documents`)
    if (res.code === 0) {
      linkedDocs.value = res.data
    }
  } catch {
    linkedDocs.value = []
  }
}

async function linkDocument() {
  const targetId = viewMode.value === 'board' ? selectedItem.value?.id : selectedItemId.value
  if (!targetId || !docIdToLink.value) return
  await $fetch(`/api/v1/work-items/${targetId}/documents`, {
    method: 'POST',
    body: { documentId: docIdToLink.value }
  })
  showLinkDoc.value = false
  docIdToLink.value = ''
  await loadLinkedDocs(targetId)
}

async function unlinkDocument(documentId: string) {
  const targetId = viewMode.value === 'board' ? selectedItem.value?.id : selectedItemId.value
  if (!targetId) return
  await $fetch(`/api/v1/work-items/${targetId}/documents/${documentId}`, {
    method: 'DELETE'
  })
  await loadLinkedDocs(targetId)
}

// ========================
// 目标弹窗（planning / in_progress / in_review / completed）
// ========================
const showTargetEditModal = ref(false)
const showTargetInfoModal = ref(false)
const editingTarget = ref<WorkItem | null>(null)
const viewingTarget = ref<WorkItem | null>(null)

function openTargetByStatus(item: WorkItem) {
  // 需求工作项（基线 / 变更）→ 跳转需求页，按 workItemId 过滤
  if (item.type === 'requirement') {
    navigateTo(`/projects/${projectId.value}/requirements?workItemId=${item.id}`)
    return
  }
  if (item.status === 'planning') {
    editingTarget.value = item
    showTargetEditModal.value = true
    return
  }
  if (item.status === 'todo') {
    const isDecomposeContainer = item.templateKey === 'requirement_breakdown' || item.templateKey === 'requirement_change'
    const subPath = isDecomposeContainer ? 'decompose' : 'breakdown'
    navigateTo(`/projects/${projectId.value}/work-items/${item.id}/${subPath}`)
    return
  }
  // in_progress / in_review / completed → 只读信息弹窗
  viewingTarget.value = item
  showTargetInfoModal.value = true
}

// ========================
// 列表详情
// ========================
function openDetail(item: WorkItem) {
  openTargetByStatus(item)
}

// ========================
// 看板详情
// ========================
async function openBoardDetail(item: WorkItem) {
  // 泳道卡片：执行中/确认中/已完成统一进入任务分解页
  if (['in_progress', 'in_review', 'completed'].includes(item.status)) {
    navigateTo(`/projects/${projectId.value}/work-items/${item.id}/breakdown`)
    return
  }
  openTargetByStatus(item)
}

async function onTargetSaved() {
  await loadBoard()
}

async function handleTransition(toStatus: string) {
  if (!selectedItem.value) return
  transitioning.value = true
  try {
    await workItemStore.updateItem(selectedItem.value.id, { status: toStatus })
    showBoardDetail.value = false
    selectedItem.value = null
    await loadBoard()
  } finally {
    transitioning.value = false
  }
}

// ========================
// 新建 & 批量
// ========================
// 待关联的文档 UUID 列表
const pendingDocIds = ref<string[]>([])
const newDocId = ref('')

function addPendingDoc() {
  const id = newDocId.value.trim()
  if (!id || pendingDocIds.value.includes(id)) return
  pendingDocIds.value.push(id)
  newDocId.value = ''
}

function removePendingDoc(id: string) {
  pendingDocIds.value = pendingDocIds.value.filter(d => d !== id)
}

const createFormTouched = ref(false)
const createFormErrors = computed(() => {
  if (!createFormTouched.value) return {} as Record<string, string>
  const errors: Record<string, string> = {}
  if (!createForm.value.milestoneId) errors.milestone = '请选择里程碑'
  if (!createForm.value.title.trim()) errors.title = '请输入标题'
  if (!createForm.value.dueDate) errors.dueDate = '请选择截止日期'
  return errors
})

async function handleCreate() {
  // 自动收入输入框中未添加的文档 UUID
  if (newDocId.value.trim()) addPendingDoc()
  createFormTouched.value = true
  if (Object.keys(createFormErrors.value).length > 0) return
  creating.value = true
  try {
    const versionId = createForm.value.tier === 'target' ? createForm.value.versionId || null : null
    const featureId = createForm.value.tier === 'target' ? createForm.value.featureId || null : null
    const createPayload: CreateWorkItemRequest = { ...createForm.value }
    delete createPayload.versionId
    delete createPayload.featureId
    const newItem = await workItemStore.createItem(projectId.value, createPayload)
    // 批量关联文档
    console.log('[WorkItems] Created item:', newItem, 'pendingDocs:', pendingDocIds.value)
    const itemId = newItem?.id
    if (itemId && (versionId || featureId)) {
      await workItemStore.updateItem(itemId, { versionId, featureId })
    }
    if (itemId && pendingDocIds.value.length > 0) {
      for (const docId of pendingDocIds.value) {
        try {
          await $fetch(`/api/v1/work-items/${itemId}/documents`, {
            method: 'POST',
            body: { documentId: docId }
          })
        } catch (err: any) {
          console.error(`[WorkItems] Failed to link doc ${docId} to item ${itemId}:`, err?.data || err)
        }
      }
    }
    showCreateModal.value = false
    pendingDocIds.value = []
    newDocId.value = ''
    createForm.value = {
      type: activeTab.value === 'bug' ? 'bug' : 'task',
      tier: 'target',
      title: '',
      milestoneId: 0,
      description: '',
      priority: 'P2',
      severity: 'medium',
      assigneeUid: '',
      dueDate: '',
      versionId: null,
      featureId: null
    }
    if (viewMode.value === 'board') {
      await loadBoard()
    }
  } finally {
    creating.value = false
  }
}

function toggleSelect(id: number) {
  const idx = selectedIds.value.indexOf(id)
  if (idx === -1) {
    selectedIds.value.push(id)
  } else {
    selectedIds.value.splice(idx, 1)
  }
}

function toggleSelectAll() {
  if (selectedIds.value.length === filteredItems.value.length) {
    selectedIds.value = []
  } else {
    selectedIds.value = filteredItems.value.map(i => i.id)
  }
}

const batchStatus = ref('')
const batchPriority = ref('')

async function handleBatchUpdate() {
  const changes: Record<string, unknown> = {}
  if (batchStatus.value) changes.status = batchStatus.value
  if (batchPriority.value) changes.priority = batchPriority.value
  if (Object.keys(changes).length > 0) {
    await workItemStore.batchUpdate(selectedIds.value, changes)
    selectedIds.value = []
    batchStatus.value = ''
    batchPriority.value = ''
    await loadItems()
  }
}

function formatDate(date: string | null) {
  if (!date) return '-'
  return date.slice(0, 10)
}

const _swimlaneOptions = [
  { label: '不分组', value: 'none' },
  { label: '按指派人', value: 'assignee' },
  { label: '按优先级', value: 'priority' }
]

const createTitleInput = ref<{ inputRef: HTMLInputElement } | null>(null)

function openCreateModal(type?: 'task' | 'bug' | 'requirement') {
  createForm.value.type = type || (activeTab.value === 'bug' ? 'bug' : activeTab.value === 'requirement' ? 'requirement' : 'task')
  const mid = activeMilestoneId.value
  if (mid !== 'all' && mid !== 'none') {
    createForm.value.milestoneId = Number(mid)
  } else {
    // 默认选当前活跃的里程碑，没有则选第一个未完成的
    const active = milestoneStore.milestones.find(m => m.status === 'active')
    const fallback = milestoneStore.milestones.find(m => m.status !== 'completed')
    createForm.value.milestoneId = active?.id || fallback?.id || 0
  }
  pendingDocIds.value = []
  newDocId.value = ''
  createForm.value.versionId = filterVersionId.value !== 'all' && filterVersionId.value !== 'none'
    ? Number(filterVersionId.value)
    : null
  createForm.value.featureId = null
  createFormTouched.value = false
  showCreateModal.value = true
  // 如果里程碑已选定，自动聚焦标题输入框
  if (createForm.value.milestoneId > 0) {
    nextTick(() => {
      createTitleInput.value?.inputRef?.focus()
    })
  }
}

// ========================
// 生命周期
// ========================
onMounted(async () => {
  if (!projectStore.currentProject || projectStore.currentProject.id !== projectId.value) {
    await projectStore.fetchProject(projectId.value)
  }
  await Promise.all([
    milestoneStore.fetchMilestones(projectId.value),
    loadVersions()
  ])

  // 默认选中进行中的里程碑
  const activeMilestone = milestoneStore.milestones.find(m => m.status === 'active')
  if (activeMilestone) {
    activeMilestoneId.value = String(activeMilestone.id)
  }

  // 看板 WIP 配置
  if (projectStore.currentProject?.boardConfig) {
    const config = projectStore.currentProject.boardConfig as any
    if (config.wipLimits) {
      wipLimits.value = { ...wipLimits.value, ...config.wipLimits }
    }
  }

  // 默认看板模式，先加载看板
  await loadBoard()
  boardMounted.value = true

  // 从 plan 页跳转带 ?milestone=xxx&create=1 时，选中里程碑并打开创建弹窗
  if (route.query.milestone && route.query.create === '1') {
    activeMilestoneId.value = String(route.query.milestone)
    nextTick(() => openCreateModal())
  }

  // 从其他页面跳转带 ?id=xxx 时，以模态窗口打开工作项详情
  const openItemId = Number(route.query.id)
  if (openItemId) {
    // 从看板数据中查找，或构造一个最小对象用于打开弹窗
    const allItems = Object.values(columnData.value).flat()
    const found = allItems.find(i => i.id === openItemId)
    if (found) {
      openBoardDetail(found)
    } else {
      // 看板中没找到（可能被筛选掉），直接 fetch 后打开
      await workItemStore.fetchItem(openItemId)
      if (workItemStore.currentItem) {
        selectedItem.value = workItemStore.currentItem as WorkItem
        showBoardDetail.value = true
      }
    }
  }
})

// 视图模式切换时加载数据
watch(viewMode, async (mode) => {
  if (mode === 'list') {
    await loadItems()
  } else {
    await loadBoard()
  }
})

// 里程碑切换时刷新数据
watch(activeMilestoneId, async () => {
  if (viewMode.value === 'list') {
    await loadItems()
  } else {
    await loadBoard()
  }
})

// 类型 tab 变化时刷新
watch(activeTab, () => {
  selectedIds.value = []
  if (viewMode.value === 'list') {
    loadItems()
  } else {
    loadBoard()
  }
})

// 列表筛选变化
watch([filterStatus, filterAssignee, filterPriority, filterSeverity, filterVersionId, searchText], () => {
  if (viewMode.value !== 'list') return
  selectedIds.value = []
  loadItems()
})

watch(swimlaneMode, (mode) => {
  if (mode === 'none') return
  clearDragState()
})

watch(childRouteActive, async (active, wasActive) => {
  if (active || !wasActive) return
  await refreshCurrentView()
})
</script>

<template>
  <NuxtPage v-if="childRouteActive" />

  <UDashboardPanel v-else id="project-work-items" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex flex-col h-full min-h-0">
        <ProjectNavbar>
          <template v-if="!isApprovalMode" #actions>
            <UButton
              v-if="canCreateWorkItem"
              icon="i-lucide-target"
              label="新建工作目标"
              color="primary"
              size="sm"
              @click="openCreateModal()"
            />
          </template>
        </ProjectNavbar>
        <div class="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-12 space-y-4">
          <!-- 里程碑页签 -->
          <div v-if="milestoneStore.milestones.length > 0" class="flex items-center gap-1 overflow-x-auto pb-1">
            <button
              v-for="mt in milestonesTabs"
              :key="mt.value"
              class="px-3 py-1.5 text-xs font-medium rounded-full transition-colors whitespace-nowrap"
              :class="[
                activeMilestoneId === mt.value
                  ? mt.status === 'completed'
                    ? 'bg-success/80 text-white'
                    : mt.status === 'active'
                      ? 'bg-primary text-white'
                      : 'bg-primary text-white'
                  : mt.status === 'completed'
                    ? 'bg-success/10 text-success hover:bg-success/20'
                    : mt.status === 'active'
                      ? 'bg-primary/10 text-primary hover:bg-primary/20'
                      : 'bg-elevated text-muted hover:text-default'
              ]"
              @click="activeMilestoneId = mt.value"
            >
              {{ mt.label }}
            </button>
          </div>

          <!-- 类型 Tab + 视图切换 -->
          <div class="flex items-center justify-between border-b border-default">
            <div class="flex items-center gap-1">
              <button
                v-for="tab in typeTabs"
                :key="tab.value"
                class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
                :class="activeTab === tab.value
                  ? 'text-primary border-primary'
                  : 'text-muted hover:text-default border-transparent'"
                @click="activeTab = tab.value"
              >
                {{ tab.label }}
              </button>
            </div>
            <div class="flex items-center gap-1 pb-1">
              <UButton
                icon="i-lucide-kanban"
                :color="viewMode === 'board' ? 'primary' : 'neutral'"
                :variant="viewMode === 'board' ? 'solid' : 'ghost'"
                size="xs"
                @click="viewMode = 'board'"
              />
              <UButton
                icon="i-lucide-list"
                :color="viewMode === 'list' ? 'primary' : 'neutral'"
                :variant="viewMode === 'list' ? 'solid' : 'ghost'"
                size="xs"
                @click="viewMode = 'list'"
              />
            </div>
          </div>

          <!-- ==================== -->
          <!-- 看板视图 -->
          <!-- ==================== -->
          <template v-if="viewMode === 'board'">
            <!-- 看板工具栏 -->
            <!-- <div class="flex items-center gap-3 flex-wrap">
              <USelect v-model="swimlaneMode" :items="swimlaneOptions" class="w-36" />
            </div> -->

            <!-- 加载中 -->
            <div v-if="workItemStore.loading" class="flex justify-center py-12">
              <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-muted" />
            </div>

            <!-- 无泳道模式 -->
            <div v-else-if="!swimlanes" class="flex gap-4 overflow-x-auto pb-4">
              <div
                v-for="col in boardColumns"
                :key="col.key"
                class="shrink-0 w-48 xl:w-11/60"
                @dragenter="onColumnDragEnter(col.key, $event)"
                @dragover="onColumnDragOver(col.key, $event)"
                @dragleave="onColumnDragLeave(col.key, $event)"
                @drop.prevent="onColumnDrop(col.key, $event)"
              >
                <!-- 列头 -->
                <div
                  class="flex items-center justify-between px-3 py-2 rounded-t-lg border-t-2"
                  :class="[columnColorClass[col.color], isWipExceeded(col.key) ? 'bg-error/10' : '']"
                >
                  <div class="min-w-0">
                    <span class="font-medium text-sm">{{ col.label }}</span>
                    <p
                      v-if="dragState"
                      class="mt-0.5 text-[11px]"
                      :class="isDropAllowed(col.key) ? 'text-success' : 'text-muted'"
                    >
                      {{ getColumnDragHint(col.key) }}
                    </p>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <UBadge
                      :color="isWipExceeded(col.key) ? 'error' : 'neutral'"
                      variant="subtle"
                      size="xs"
                    >
                      {{ columnValueRefs[col.key]!.value.length }}
                      <span v-if="wipLimits[col.key]"> / {{ wipLimits[col.key] }}</span>
                    </UBadge>
                  </div>
                </div>

                <!-- 卡片列表 -->
                <div
                  class="space-y-2 p-2 bg-elevated/50 rounded-b-lg min-h-32 transition-colors"
                  :class="[
                    dragState && isDropAllowed(col.key) ? 'bg-success/5' : '',
                    dragState && !isDropAllowed(col.key) && col.key !== dragState.fromColKey ? 'bg-error/5' : '',
                    dragOverColumnKey === col.key && isDropAllowed(col.key) ? 'ring-2 ring-primary/30 bg-primary/5' : '',
                    dragOverColumnKey === col.key && !isDropAllowed(col.key) ? 'ring-2 ring-error/30' : ''
                  ]"
                  @dragenter.stop="onColumnDragEnter(col.key, $event)"
                  @dragover.stop="onColumnDragOver(col.key, $event)"
                  @dragleave.stop="onColumnDragLeave(col.key, $event)"
                  @drop.stop.prevent="onColumnDrop(col.key, $event)"
                >
                  <div
                    v-for="item in columnValueRefs[col.key]!.value"
                    :key="item.id"
                    class="bg-default p-3 rounded-md shadow-sm cursor-grab hover:shadow-md transition-shadow border border-default active:cursor-grabbing"
                    :class="dragState?.item.id === item.id ? 'opacity-50' : ''"
                    :draggable="isWorkItemEditable ? 'true' : 'false'"
                    @pointerdown="onCardPointerDown"
                    @dragstart="isWorkItemEditable && onCardDragStart(col.key, item, $event)"
                    @dragend="onCardDragEnd"
                    @dragenter.stop="onColumnDragEnter(col.key, $event)"
                    @dragover.stop="onColumnDragOver(col.key, $event)"
                    @drop.stop.prevent="onColumnDrop(col.key, $event)"
                    @click="onCardClick($event, item)"
                  >
                    <div class="flex items-center gap-2 mb-2">
                      <UIcon
                        :name="typeConfig[item.type as keyof typeof typeConfig]?.icon || 'i-lucide-circle'"
                        :class="['w-3.5 h-3.5', typeConfig[item.type as keyof typeof typeConfig]?.color || '']"
                      />
                      <span class="font-mono text-xs text-muted">{{ item.itemKey }}</span>
                    </div>
                    <p class="text-sm font-medium line-clamp-2 mb-2">
                      {{ item.title }}
                    </p>
                    <div class="flex items-center justify-between">
                      <UBadge :color="(priorityConfig[item.priority as keyof typeof priorityConfig]?.color as any)" variant="subtle" size="xs">
                        {{ item.priority }}
                      </UBadge>
                      <span v-if="item.assigneeUid" class="text-xs text-muted">
                        {{ getUserName(item.assigneeUid) }}
                      </span>
                    </div>
                  </div>

                  <div v-if="columnValueRefs[col.key]!.value.length === 0" class="text-center py-8 text-xs text-muted">
                    暂无
                  </div>
                </div>
              </div>
            </div>

            <!-- 泳道模式 -->
            <div v-else class="space-y-6 overflow-x-auto pb-4">
              <div
                v-for="lane in swimlanes"
                :key="lane.key"
                class="border border-default rounded-lg"
              >
                <div class="px-4 py-2 bg-elevated/50 border-b border-default font-medium text-sm flex items-center gap-2">
                  <UIcon v-if="swimlaneMode === 'assignee'" name="i-lucide-user" class="w-4 h-4" />
                  <UIcon v-else name="i-lucide-signal" class="w-4 h-4" />
                  {{ lane.label }}
                  <UBadge color="neutral" variant="subtle" size="xs">
                    {{ boardColumns.reduce((sum, col) => sum + getSwimlanColumnItems(col.key, lane.key).length, 0) }}
                  </UBadge>
                </div>

                <div class="flex gap-4 p-3 overflow-x-auto">
                  <div
                    v-for="col in boardColumns"
                    :key="col.key"
                    class="shrink-0 w-56"
                  >
                    <div class="text-xs text-muted mb-1.5 px-1">
                      {{ col.label }} ({{ getSwimlanColumnItems(col.key, lane.key).length }})
                    </div>
                    <div class="space-y-2 min-h-16">
                      <div
                        v-for="item in getSwimlanColumnItems(col.key, lane.key)"
                        :key="item.id"
                        class="bg-default p-2.5 rounded-md shadow-sm cursor-pointer hover:shadow-md transition-shadow border border-default"
                        @click="openBoardDetail(item)"
                      >
                        <div class="flex items-center gap-1.5 mb-1">
                          <UIcon
                            :name="typeConfig[item.type as keyof typeof typeConfig]?.icon || 'i-lucide-circle'"
                            :class="['w-3 h-3', typeConfig[item.type as keyof typeof typeConfig]?.color || '']"
                          />
                          <span class="font-mono text-xs text-muted">{{ item.itemKey }}</span>
                        </div>
                        <p class="text-xs font-medium line-clamp-2">
                          {{ item.title }}
                        </p>
                      </div>
                      <div v-if="getSwimlanColumnItems(col.key, lane.key).length === 0" class="text-center py-4 text-xs text-muted">
                        -
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 看板详情弹窗 -->
            <UModal v-model:open="showBoardDetail">
              <template #header>
                <div class="flex items-center justify-between w-full">
                  <div class="flex items-center gap-2">
                    <UIcon
                      v-if="selectedItem"
                      :name="typeConfig[selectedItem.type as keyof typeof typeConfig]?.icon || 'i-lucide-circle'"
                      class="w-5 h-5"
                    />
                    <span class="font-mono text-sm text-muted">{{ selectedItem?.itemKey }}</span>
                    <UBadge
                      v-if="selectedItem"
                      color="info"
                      variant="subtle"
                      size="xs"
                    >
                      {{ typeConfig[selectedItem.type as keyof typeof typeConfig]?.label || selectedItem.type }}
                    </UBadge>
                  </div>
                  <UButton
                    icon="i-lucide-x"
                    variant="ghost"
                    color="neutral"
                    size="xs"
                    @click="showBoardDetail = false"
                  />
                </div>
              </template>
              <template #body>
                <div v-if="selectedItem" class="space-y-5">
                  <h3 class="text-lg font-semibold">
                    {{ selectedItem.title }}
                  </h3>

                  <div class="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span class="text-muted">状态</span>
                      <div class="mt-1">
                        <UBadge color="primary" variant="subtle">
                          {{ getStatusLabel(selectedItem.status) }}
                        </UBadge>
                      </div>
                    </div>
                    <div>
                      <span class="text-muted">优先级</span>
                      <div class="mt-1">
                        <UBadge :color="(priorityConfig[selectedItem.priority as keyof typeof priorityConfig]?.color as any)" variant="subtle">
                          {{ selectedItem.priority }}
                        </UBadge>
                      </div>
                    </div>
                    <div>
                      <span class="text-muted">创建人</span>
                      <p class="mt-1">
                        {{ getUserName(selectedItem.reporterUid) || '-' }}
                      </p>
                    </div>
                    <div>
                      <span class="text-muted">负责人</span>
                      <p class="mt-1">
                        {{ getUserName(selectedItem.assigneeUid) }}
                      </p>
                    </div>
                    <div v-if="selectedItem.dueDate">
                      <span class="text-muted">截止日期</span>
                      <p class="mt-1">
                        {{ selectedItem.dueDate?.toString().slice(0, 10) }}
                      </p>
                    </div>
                    <div v-if="selectedItem.estimatedHours">
                      <span class="text-muted">预估工时</span>
                      <p class="mt-1">
                        {{ selectedItem.estimatedHours }}h
                      </p>
                    </div>
                    <div v-if="selectedItem.type === 'bug' && selectedItem.severity">
                      <span class="text-muted">严重程度</span>
                      <p class="mt-1">
                        {{ severityConfig[selectedItem.severity as keyof typeof severityConfig]?.label || selectedItem.severity }}
                      </p>
                    </div>
                  </div>

                  <div v-if="selectedItem.description">
                    <span class="text-sm text-muted">描述</span>
                    <MarkdownContent
                      :markdown="selectedItem.description"
                      class="mt-1 bg-elevated/50 rounded-md p-3 text-sm"
                    />
                  </div>

                  <!-- 暂停提示 -->
                  <div v-if="workItemReadonlyReason" class="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                    {{ workItemReadonlyReason }}
                  </div>
                  <div v-if="isWorkItemEditable && availableTransitions.length > 0" class="border-t border-default pt-4">
                    <span class="text-sm text-muted mb-2 block">可执行操作</span>
                    <div class="flex flex-wrap gap-2">
                      <UButton
                        v-for="t in availableTransitions"
                        :key="t.transitionKey"
                        :label="transitionLabels[t.transitionKey] || t.transitionKey"
                        :color="(transitionColor[t.transitionKey] || 'primary') as any"
                        variant="soft"
                        size="sm"
                        :loading="transitioning"
                        @click="handleTransition(t.toStatus)"
                      />
                    </div>
                  </div>

                  <!-- 工时记录 -->
                  <div class="border-t border-default pt-4">
                    <div class="flex items-center justify-between mb-2">
                      <span class="text-sm text-muted">工时记录</span>
                      <UButton
                        icon="i-lucide-plus"
                        label="记录"
                        variant="ghost"
                        size="xs"
                        @click="showTimeEntry = true"
                      />
                    </div>
                    <div v-if="showTimeEntry" class="space-y-2 mb-3 p-3 bg-elevated/50 rounded-md">
                      <div class="grid grid-cols-2 gap-2">
                        <UInput v-model="timeEntryForm.entryDate" type="date" />
                        <UInput
                          v-model="timeEntryForm.hours"
                          type="number"
                          placeholder="工时(h)"
                          step="0.5"
                          min="0.5"
                        />
                      </div>
                      <UInput v-model="timeEntryForm.description" placeholder="工作内容描述" />
                      <div class="flex gap-2">
                        <UButton
                          label="保存"
                          color="primary"
                          size="xs"
                          :loading="savingTimeEntry"
                          @click="saveTimeEntry"
                        />
                        <UButton
                          label="取消"
                          variant="ghost"
                          size="xs"
                          @click="showTimeEntry = false"
                        />
                      </div>
                    </div>
                    <div v-if="timeEntries.length > 0" class="space-y-1.5">
                      <div v-for="te in timeEntries" :key="te.id" class="flex items-center justify-between text-xs py-1">
                        <span class="text-muted">{{ te.entryDate }} · {{ getUserName(te.uid) }}</span>
                        <span>{{ te.hours }}h</span>
                      </div>
                    </div>
                    <div v-else-if="!showTimeEntry" class="text-xs text-muted">
                      暂无工时记录
                    </div>
                  </div>

                  <!-- 关联文档 -->
                  <div class="border-t border-default pt-4">
                    <div class="flex items-center justify-between mb-2">
                      <span class="text-sm text-muted">关联文档</span>
                      <UButton
                        icon="i-lucide-plus"
                        label="关联"
                        variant="ghost"
                        size="xs"
                        @click="showLinkDoc = true"
                      />
                    </div>
                    <div v-if="showLinkDoc" class="flex gap-2 mb-3">
                      <UInput v-model="docIdToLink" placeholder="Codocs 文档 ID" class="flex-1" />
                      <UButton
                        label="确定"
                        color="primary"
                        size="xs"
                        @click="linkDocument"
                      />
                      <UButton
                        label="取消"
                        variant="ghost"
                        size="xs"
                        @click="showLinkDoc = false"
                      />
                    </div>
                    <div v-if="linkedDocs.length > 0" class="space-y-1.5">
                      <div v-for="doc in linkedDocs" :key="doc.id" class="flex items-center justify-between text-xs py-1">
                        <span>文档 #{{ doc.documentId }}</span>
                        <UButton
                          icon="i-lucide-x"
                          variant="ghost"
                          size="xs"
                          color="neutral"
                          @click="unlinkDocument(doc.documentId)"
                        />
                      </div>
                    </div>
                    <div v-else-if="!showLinkDoc" class="text-xs text-muted">
                      暂无关联文档
                    </div>
                  </div>
                </div>
              </template>
            </UModal>
          </template>

          <!-- ==================== -->
          <!-- 列表视图 -->
          <!-- ==================== -->
          <template v-if="viewMode === 'list'">
            <!-- 筛选栏 -->
            <div class="flex flex-wrap items-center gap-3">
              <USelect
                v-if="activeTab === 'all'"
                v-model="filterStatus"
                :items="statusOptions"
                class="w-32"
              />
              <USelect
                v-else
                v-model="filterStatus"
                :items="statusOptions"
                class="w-32"
              />
              <USelect v-model="filterPriority" :items="filterPriorityOptions" class="w-36" />
              <USelect v-model="filterVersionId" :items="versionFilterOptions" class="w-44" />
              <USelect
                v-if="activeTab === 'bug'"
                v-model="filterSeverity"
                :items="filterSeverityOptions"
                class="w-40"
              />
              <UInput
                v-model="searchText"
                icon="i-lucide-search"
                placeholder="搜索..."
                class="w-48"
              />
            </div>

            <!-- 批量操作栏 -->
            <div v-if="showBatchBar" class="flex items-center gap-3 p-3 bg-primary/5 rounded-lg">
              <span class="text-sm font-medium">已选 {{ selectedIds.length }} 项</span>
              <USelect
                v-model="batchStatus"
                :items="statusOptions.filter(o => o.value !== 'all')"
                placeholder="批量改状态"
                class="w-32"
              />
              <USelect
                v-model="batchPriority"
                :items="filterPriorityOptions.filter(o => o.value !== 'all')"
                placeholder="批量改优先级"
                class="w-36"
              />
              <UButton
                label="应用"
                color="primary"
                size="sm"
                :disabled="!isWorkItemEditable"
                @click="handleBatchUpdate"
              />
              <UButton
                label="取消"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="selectedIds = []"
              />
            </div>

            <!-- 加载中 -->
            <div v-if="workItemStore.loading" class="flex justify-center py-12">
              <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-muted" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="filteredItems.length === 0" class="text-center py-12 text-muted">
              <UIcon name="i-lucide-inbox" class="w-12 h-12 mx-auto mb-3" />
              <p>暂无工作项</p>
              <UButton
                v-if="canCreateWorkItem"
                label="创建工作项"
                color="primary"
                variant="soft"
                class="mt-3"
                @click="openCreateModal()"
              />
            </div>

            <!-- 工作项表格 -->
            <UTable
              v-else
              :data="filteredItems"
              :columns="columns"
              class="w-full"
            >
              <template #select-header>
                <input
                  type="checkbox"
                  :checked="selectedIds.length === filteredItems.length && filteredItems.length > 0"
                  class="rounded"
                  @change="toggleSelectAll"
                >
              </template>
              <template #select-cell="{ row }">
                <input
                  type="checkbox"
                  :checked="selectedIds.includes(row.original.id)"
                  class="rounded"
                  @click.stop
                  @change="toggleSelect(row.original.id)"
                >
              </template>
              <template #itemKey-cell="{ row }">
                <span
                  class="font-mono text-xs text-primary cursor-pointer hover:underline"
                  @click="openDetail(row.original)"
                >
                  {{ row.original.itemKey }}
                </span>
              </template>
              <template #type-cell="{ row }">
                <UIcon
                  :name="typeConfig[row.original.type as keyof typeof typeConfig]?.icon || 'i-lucide-circle'"
                  :class="['w-4 h-4', typeConfig[row.original.type as keyof typeof typeConfig]?.color || '']"
                />
              </template>
              <template #title-cell="{ row }">
                <span
                  class="cursor-pointer hover:text-primary transition-colors"
                  @click="openDetail(row.original)"
                >
                  {{ row.original.title }}
                </span>
              </template>
              <template #status-cell="{ row }">
                <div class="flex items-center gap-1">
                  <UBadge :color="(getStatusColor(row.original.status) as any)" variant="subtle" size="xs">
                    {{ getStatusLabel(row.original.status) }}
                  </UBadge>
                  <UBadge
                    v-if="row.original.approvalStatus === 'pending'"
                    color="warning"
                    variant="soft"
                    size="xs"
                  >
                    待审批
                  </UBadge>
                  <UBadge
                    v-else-if="row.original.approvalStatus === 'approved'"
                    color="success"
                    variant="soft"
                    size="xs"
                  >
                    已通过
                  </UBadge>
                  <UBadge
                    v-else-if="row.original.approvalStatus === 'rejected'"
                    color="error"
                    variant="soft"
                    size="xs"
                  >
                    已驳回
                  </UBadge>
                </div>
              </template>
              <template #priority-cell="{ row }">
                <UBadge :color="(priorityConfig[row.original.priority as keyof typeof priorityConfig]?.color as any)" variant="subtle" size="xs">
                  {{ row.original.priority }}
                </UBadge>
              </template>
              <template #severity-cell="{ row }">
                <UBadge
                  v-if="row.original.severity"
                  :color="(severityConfig[row.original.severity as keyof typeof severityConfig]?.color as any)"
                  variant="subtle"
                  size="xs"
                >
                  {{ severityConfig[row.original.severity as keyof typeof severityConfig]?.label || row.original.severity }}
                </UBadge>
                <span v-else class="text-muted">-</span>
              </template>
              <template #versionId-cell="{ row }">
                <UBadge
                  v-if="row.original.versionId"
                  color="info"
                  variant="subtle"
                  size="xs"
                >
                  {{ versionLabel(row.original.versionId) }}
                </UBadge>
                <span v-else class="text-muted">-</span>
              </template>
              <template #assigneeUid-cell="{ row }">
                {{ row.original.assigneeName || row.original.assigneeUid || '-' }}
              </template>
              <template #dueDate-cell="{ row }">
                {{ formatDate(row.original.dueDate) }}
              </template>
            </UTable>

            <!-- 工作项详情侧边栏 -->
            <USlideover v-model:open="showDetail">
              <template #header>
                <h3 class="text-lg font-semibold">
                  工作项详情
                </h3>
              </template>
              <template #body>
                <div v-if="workItemStore.currentItem" class="p-4 space-y-4">
                  <div class="flex items-center gap-2">
                    <UIcon
                      :name="typeConfig[workItemStore.currentItem.type as keyof typeof typeConfig]?.icon || 'i-lucide-circle'"
                      :class="['w-5 h-5', typeConfig[workItemStore.currentItem.type as keyof typeof typeConfig]?.color || '']"
                    />
                    <span class="font-mono text-sm text-muted">{{ workItemStore.currentItem.itemKey }}</span>
                  </div>

                  <h2 class="text-lg font-semibold">
                    {{ workItemStore.currentItem.title }}
                  </h2>

                  <div class="flex flex-wrap gap-2">
                    <UBadge :color="(getStatusColor(workItemStore.currentItem.status) as any)" variant="subtle">
                      {{ getStatusLabel(workItemStore.currentItem.status) }}
                    </UBadge>
                    <UBadge :color="(priorityConfig[workItemStore.currentItem.priority as keyof typeof priorityConfig]?.color as any)" variant="subtle">
                      {{ workItemStore.currentItem.priority }}
                    </UBadge>
                    <UBadge
                      v-if="workItemStore.currentItem.severity"
                      :color="(severityConfig[workItemStore.currentItem.severity as keyof typeof severityConfig]?.color as any)"
                      variant="subtle"
                    >
                      {{ severityConfig[workItemStore.currentItem.severity as keyof typeof severityConfig]?.label || workItemStore.currentItem.severity }}
                    </UBadge>
                  </div>

                  <div class="space-y-2 text-sm">
                    <div class="flex justify-between">
                      <span class="text-muted">指派人</span>
                      <span>{{ getUserName(workItemStore.currentItem.assigneeUid) }}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-muted">报告人</span>
                      <span>{{ workItemStore.currentItem.reporterName || workItemStore.currentItem.reporterUid || '-' }}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-muted">截止日期</span>
                      <span>{{ formatDate(workItemStore.currentItem.dueDate) }}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-muted">预估工时</span>
                      <span>{{ workItemStore.currentItem.estimatedHours ? workItemStore.currentItem.estimatedHours + 'h' : '-' }}</span>
                    </div>
                  </div>

                  <div v-if="workItemStore.currentItem.description" class="border-t border-default pt-4">
                    <h3 class="font-medium mb-2">
                      描述
                    </h3>
                    <p class="text-sm text-muted whitespace-pre-wrap">
                      {{ workItemStore.currentItem.description }}
                    </p>
                  </div>

                  <!-- 评论 -->
                  <div class="border-t border-default pt-4">
                    <h3 class="font-medium mb-3">
                      评论
                    </h3>
                    <div v-if="workItemStore.currentItem.comments?.length" class="space-y-3">
                      <div
                        v-for="comment in workItemStore.currentItem.comments"
                        :key="comment.id"
                        class="bg-elevated p-3 rounded-md"
                      >
                        <div class="flex items-center justify-between mb-1">
                          <span class="text-sm font-medium">{{ comment.authorName || comment.authorUid }}</span>
                          <span class="text-xs text-muted">{{ formatDate(comment.createdAt) }}</span>
                        </div>
                        <p class="text-sm">
                          {{ comment.content }}
                        </p>
                      </div>
                    </div>
                    <div v-else class="text-sm text-muted">
                      暂无评论
                    </div>
                  </div>

                  <!-- 工时记录 -->
                  <div class="border-t border-default pt-4">
                    <div class="flex items-center justify-between mb-2">
                      <span class="text-sm text-muted">工时记录</span>
                      <UButton
                        icon="i-lucide-plus"
                        label="记录"
                        variant="ghost"
                        size="xs"
                        @click="showTimeEntry = true"
                      />
                    </div>
                    <div v-if="showTimeEntry" class="space-y-2 mb-3 p-3 bg-elevated/50 rounded-md">
                      <div class="grid grid-cols-2 gap-2">
                        <UInput v-model="timeEntryForm.entryDate" type="date" />
                        <UInput
                          v-model="timeEntryForm.hours"
                          type="number"
                          placeholder="工时(h)"
                          step="0.5"
                          min="0.5"
                        />
                      </div>
                      <UInput v-model="timeEntryForm.description" placeholder="工作内容描述" />
                      <div class="flex gap-2">
                        <UButton
                          label="保存"
                          color="primary"
                          size="xs"
                          :loading="savingTimeEntry"
                          @click="saveTimeEntry"
                        />
                        <UButton
                          label="取消"
                          variant="ghost"
                          size="xs"
                          @click="showTimeEntry = false"
                        />
                      </div>
                    </div>
                    <div v-if="timeEntries.length > 0" class="space-y-1.5">
                      <div v-for="te in timeEntries" :key="te.id" class="flex items-center justify-between text-xs py-1">
                        <span class="text-muted">{{ te.entryDate }} · {{ getUserName(te.uid) }}</span>
                        <span>{{ te.hours }}h</span>
                      </div>
                    </div>
                    <div v-else-if="!showTimeEntry" class="text-xs text-muted">
                      暂无工时记录
                    </div>
                  </div>

                  <!-- 关联文档 -->
                  <div class="border-t border-default pt-4">
                    <div class="flex items-center justify-between mb-2">
                      <span class="text-sm text-muted">关联文档</span>
                      <UButton
                        icon="i-lucide-plus"
                        label="关联"
                        variant="ghost"
                        size="xs"
                        @click="showLinkDoc = true"
                      />
                    </div>
                    <div v-if="showLinkDoc" class="flex gap-2 mb-3">
                      <UInput v-model="docIdToLink" placeholder="Codocs 文档 ID" class="flex-1" />
                      <UButton
                        label="确定"
                        color="primary"
                        size="xs"
                        @click="linkDocument"
                      />
                      <UButton
                        label="取消"
                        variant="ghost"
                        size="xs"
                        @click="showLinkDoc = false"
                      />
                    </div>
                    <div v-if="linkedDocs.length > 0" class="space-y-1.5">
                      <div v-for="doc in linkedDocs" :key="doc.id" class="flex items-center justify-between text-xs py-1">
                        <span>文档 #{{ doc.documentId }}</span>
                        <UButton
                          icon="i-lucide-x"
                          variant="ghost"
                          size="xs"
                          color="neutral"
                          @click="unlinkDocument(doc.documentId)"
                        />
                      </div>
                    </div>
                    <div v-else-if="!showLinkDoc" class="text-xs text-muted">
                      暂无关联文档
                    </div>
                  </div>
                </div>
                <div v-else class="flex justify-center py-12">
                  <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin text-muted" />
                </div>
              </template>
            </USlideover>
          </template>

          <!-- 新建工作项弹窗（共用） -->
          <UModal v-model:open="showCreateModal">
            <template #header>
              <h3 class="text-lg font-semibold">
                新建工作目标
              </h3>
            </template>
            <template #body>
              <div class="space-y-4 p-4">
                <div class="grid grid-cols-2 gap-4">
                  <UFormField label="里程碑" required :error="createFormErrors.milestone">
                    <URadioGroup
                      :model-value="createForm.milestoneId"
                      :items="milestoneSelectOptions"
                      value-key="value"
                      label-key="label"
                      orientation="horizontal"
                      size="sm"
                      @update:model-value="createForm.milestoneId = Number($event)"
                    />
                  </UFormField>
                  <UFormField
                    label="类型"
                    required
                    :hint="createFormIsPlanningStage ? 'P 阶段只能新增任务类工作目标' : undefined"
                  >
                    <URadioGroup
                      v-model="(createForm.type as string)"
                      :items="createTypeOptions"
                      orientation="horizontal"
                      size="sm"
                    />
                  </UFormField>
                </div>
                <UFormField label="标题" required :error="createFormErrors.title">
                  <UInput
                    ref="createTitleInput"
                    v-model="createForm.title"
                    placeholder="输入标题"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="描述">
                  <UTextarea
                    v-model="createForm.description!"
                    placeholder="输入描述"
                    class="w-full"
                    :rows="3"
                  />
                </UFormField>
                <div class="grid grid-cols-2 gap-4">
                  <UFormField label="优先级">
                    <URadioGroup
                      v-model="(createForm.priority as string)"
                      :items="[
                        { label: 'P0 紧急', value: 'P0' },
                        { label: 'P1 高', value: 'P1' },
                        { label: 'P2 中', value: 'P2' },
                        { label: 'P3 低', value: 'P3' }
                      ]"
                      orientation="horizontal"
                      size="sm"
                    />
                  </UFormField>
                  <UFormField label="截止日期" required :error="createFormErrors.dueDate">
                    <UInput
                      v-model="createForm.dueDate!"
                      type="date"
                      class="w-full"
                      required
                    />
                  </UFormField>

                  <UFormField v-if="createForm.type === 'bug'" label="严重程度">
                    <URadioGroup
                      v-model="(createForm.severity as string)"
                      :items="filterSeverityOptions.filter(o => o.value !== 'all')"
                      orientation="horizontal"
                      size="sm"
                    />
                  <!-- <USelect v-model="(createForm.severity as string)" :items="filterSeverityOptions.filter(o => o.value !== 'all')" class="w-full" /> -->
                  </UFormField>

                  <UFormField label="影响范围">
                    <URadioGroup
                      v-model="(createForm.tier as string)"
                      :items="tierOptionsForType"
                      orientation="horizontal"
                      size="sm"
                    />
                    <USelectMenu
                      v-if="createForm.tier === 'matter'"
                      v-model="(createForm.assigneeUid as string)"
                      :items="memberOptions"
                      value-key="value"
                      label-key="label"
                      placeholder="选择成员"
                      class="w-48"
                      searchable
                      size="sm"
                      :disabled="createForm.tier !== 'matter'"
                    />
                  </UFormField>
                  <UFormField v-if="createForm.tier === 'target'" label="关联版本">
                    <USelect
                      :model-value="createForm.versionId || 0"
                      :items="createVersionOptions"
                      value-key="value"
                      label-key="label"
                      class="w-full"
                      @update:model-value="createForm.versionId = Number($event) || null"
                    />
                  </UFormField>
                </div>
                <UFormField label="关联文档">
                  <div class="space-y-2">
                    <div class="flex items-center gap-2">
                      <UInput
                        v-model="newDocId"
                        placeholder="粘贴 Codocs 文档 UUID，回车添加"
                        class="flex-1"
                        @keydown.enter.prevent="addPendingDoc"
                        @paste="nextTick(() => addPendingDoc())"
                      />
                      <UButton
                        label="添加"
                        icon="i-lucide-plus"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        :disabled="!newDocId.trim()"
                        @click="addPendingDoc"
                      />
                    </div>
                    <div v-if="pendingDocIds.length > 0" class="flex flex-wrap gap-1.5">
                      <UBadge
                        v-for="docId in pendingDocIds"
                        :key="docId"
                        color="info"
                        variant="subtle"
                        size="sm"
                        class="font-mono"
                      >
                        {{ docId.slice(0, 8) }}...
                        <button class="ml-1 hover:text-error" @click="removePendingDoc(docId)">
                          <UIcon name="i-lucide-x" class="size-3" />
                        </button>
                      </UBadge>
                    </div>
                  </div>
                </UFormField>
              </div>
            </template>
            <template #footer>
              <div class="flex justify-end gap-2">
                <UButton
                  label="取消"
                  color="neutral"
                  variant="ghost"
                  @click="showCreateModal = false"
                />
                <UButton
                  label="创建"
                  color="primary"
                  :loading="creating"
                  @click="handleCreate"
                />
              </div>
            </template>
          </UModal>

          <!-- 目标编辑弹窗（目标规划列） -->
          <TargetEditModal
            v-model:open="showTargetEditModal"
            :work-item="editingTarget"
            :milestones="milestoneStore.milestones"
            @saved="onTargetSaved"
          />

          <!-- 目标只读信息弹窗（执行中/确认中/已完成列） -->
          <TargetInfoModal
            v-model:open="showTargetInfoModal"
            :work-item="viewingTarget"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
