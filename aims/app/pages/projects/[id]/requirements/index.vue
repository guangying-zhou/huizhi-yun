<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'

const route = useRoute()
const { resolveCurrentAppUrl } = useAppUrls()
const projectId = computed(() => Number(route.params.id))

// Initialize activeTab from URL query so deep-links land on the right tab immediately
type RequirementsTab = 'spec' | 'list' | 'review'
const routeTab = (route.query.tab === 'review' || route.query.tab === 'spec' || route.query.tab === 'list')
  ? route.query.tab
  : null
const initialTab: RequirementsTab = routeTab || 'list'
const activeTab = ref<RequirementsTab>(initialTab)
const requirementTabs = [
  {
    label: '规格书',
    icon: 'i-lucide-book-open',
    value: 'spec',
    slot: 'spec' as const
  },
  {
    label: '需求列表',
    icon: 'i-lucide-list',
    value: 'list',
    slot: 'list' as const
  },
  {
    label: '需求评审',
    icon: 'i-lucide-clipboard-check',
    value: 'review',
    slot: 'review' as const
  }
] satisfies TabsItem[]

const { items, total, baselineSummary, loading: listLoading, filters, fetchList } = useRequirements(projectId)
const { spec, contents, linkedRequirements, loading: specLoading, fetchSpec, contentTree } = useRequirementSpec(projectId)
const showDeletedContents = ref(false)
async function fetchSpecByVisibility() {
  await fetchSpec({ includeDeleted: showDeletedContents.value })
}
const milestoneStore = useMilestoneStore()
const hasGeneratedSpecRequirements = computed(() => contents.value.some(content => content.requirementId != null))
const hasImportedSpec = computed(() => ['imported_clean', 'imported_dirty', 'imported_locked'].includes(spec.value?.importStatus || ''))

// 当前视图对应的需求工作项（基线 or 变更批次）
interface RequirementTargetInfo {
  id: number
  itemKey: string
  title: string
  status: string
  milestoneId: number | null
  milestoneName: string | null
  milestonePivrStage: string | null
  isBaseline: boolean
  requirementCount: number
  taskCount: number
}
const requirementTargets = ref<RequirementTargetInfo[]>([])
const activeTargetId = ref<number | null>(
  route.query.workItemId ? Number(route.query.workItemId) : null
)
const activeTarget = computed(() => requirementTargets.value.find(t => t.id === activeTargetId.value) || null)
const allRequirementCount = computed(() => requirementTargets.value.reduce((sum, item) => sum + item.requirementCount, 0))
const normalizedRequirementSearch = computed(() => filters.search.trim())
let requirementTargetsRequestId = 0

function pickDefaultTargetId(items: RequirementTargetInfo[]): number | null {
  if (items.length === 0) return null
  // 1. 当前里程碑（active）的第一个 requirement target
  const activeMilestone = milestoneStore.milestones.find(m => m.status === 'active')
  if (activeMilestone) {
    const fromActive = items.find(t => t.milestoneId === activeMilestone.id)
    if (fromActive) return fromActive.id
  }
  // 2. fallback 到第一个 target
  return items[0]!.id
}

async function fetchRequirementTargets() {
  const requestId = ++requirementTargetsRequestId
  try {
    const res = await $fetch<{ code: number, data: { items: RequirementTargetInfo[] } }>(
      `/api/v1/projects/${projectId.value}/requirement-targets`,
      {
        params: {
          type: filters.type,
          status: filters.status,
          priority: filters.priority,
          milestone_id: filters.milestoneId || undefined,
          source: filters.source || undefined,
          search: normalizedRequirementSearch.value || undefined
        }
      }
    )
    if (requestId !== requirementTargetsRequestId) return
    if (res.code === 0) {
      requirementTargets.value = res.data.items
      if (activeTargetId.value && !res.data.items.some(t => t.id === activeTargetId.value)) {
        activeTargetId.value = null
      }
      // 进入页面时（未通过 URL 指定）默认选中当前里程碑下第一个 requirement target
      if (activeTargetId.value == null) {
        activeTargetId.value = pickDefaultTargetId(res.data.items)
      }
      syncWorkItemFilter()
    }
  } catch (err) {
    console.error('[fetchRequirementTargets] failed:', err)
  }
}

function syncWorkItemFilter() {
  filters.workItemId = activeTargetId.value ? String(activeTargetId.value) : ''
}

watch(activeTargetId, () => {
  syncWorkItemFilter()
  filters.page = 1
  fetchList()
})

watch(
  () => [filters.type, filters.status, filters.priority, filters.milestoneId, filters.source, normalizedRequirementSearch.value] as const,
  () => {
    filters.page = 1
    fetchList()
    fetchRequirementTargets()
  }
)

watch(
  () => [filters.sort, filters.order, filters.page, filters.pageSize] as const,
  () => {
    fetchList()
  }
)

watch(activeTab, (tab) => {
  if (tab === 'list') {
    fetchList()
  } else if (tab === 'review') {
    fetchBatches()
    // 刷新 baselineSummary，保证"还有未纳入批次的草稿基线"校验为最新
    fetchList()
  }
})

const defaultImplMilestoneId = computed(() => {
  const impl = milestoneStore.milestones.find(m => m.pivrStage === 'I')
  return impl?.id ?? null
})

const selectedReqs = ref<number[]>([])
const showImportModal = ref(false)
const showImportPicker = ref(false)
const importInitialDocRef = ref<import('~/composables/useAimsDocumentPicker').DocumentRef | null>(null)
const showCreateRequirementModal = ref(false)
const showDetailModal = ref(false)
const activeReqId = ref<number | null>(null)

function onImportClick() {
  importInitialDocRef.value = null
  showImportPicker.value = true
}

function onImportDocPicked(docRef: import('~/composables/useAimsDocumentPicker').DocumentRef) {
  importInitialDocRef.value = docRef
  showImportPicker.value = false
  showImportModal.value = true
}

// Create-task dialog state
interface RequirementListItem {
  id: number
  reqCode: string
  title: string
  priority: string
  milestoneId: number | null
  milestoneName: string | null
  type?: 'functional' | 'non_functional'
}
const createTaskReq = ref<RequirementListItem | null>(null)
function openCreateTaskDialog(req: RequirementListItem) {
  createTaskReq.value = req
}
const { users: accountUsers } = useAccountUsers()
const accountUserNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const user of accountUsers.value) {
    map.set(user.uid, user.realName?.trim() || user.nickname?.trim() || user.uid)
  }
  return map
})

function getUserName(uid: string | null | undefined) {
  if (!uid) return '-'
  return accountUserNameMap.value.get(uid) || uid
}

// Review batches
interface ReviewBatch {
  id: number
  batchType: 'baseline' | 'change'
  title: string
  description: string | null
  requirementIds: number[]
  requirements: ReviewBatchRequirement[]
  status: 'pending' | 'approved' | 'rejected'
  workflowInstanceId: string | null
  submittedBy: string
  submittedAt: string
  closedAt: string | null
}
interface ReviewBatchRequirement {
  id: number
  itemKind?: 'baseline' | 'change'
  parentRequirementId?: number | null
  milestoneId?: number | null
  milestoneName?: string | null
  reqCode: string
  title: string
  status: string
  priority?: string
  changeReason?: string | null
  scopeNote?: string | null
}
const batches = ref<ReviewBatch[]>([])
const activeBatchId = ref<number | null>(null)
const activeBatch = computed(() => batches.value.find(b => b.id === activeBatchId.value) || null)
interface ChangeDiffItem {
  contentOriginalId: number
  diffStatus: 'changed' | 'unchanged' | 'added'
  base: { id: number, title: string | null, contentMd: string | null, versionNo: number | null } | null
  change: { id: number, title: string, contentMd: string | null, versionNo: number }
}
interface ChangeDiffResponse {
  code: number
  data: {
    requirement: {
      id: number
      reqCode: string
      title: string
      parentReqCode: string
      parentTitle: string
    }
    items: ChangeDiffItem[]
  }
}
const changeDiffs = ref<Record<number, ChangeDiffResponse['data']>>({})
const showWithdrawModal = ref(false)
const pendingWithdrawBatchId = ref<number | null>(null)
const withdrawingBatch = ref(false)
const showDeleteModal = ref(false)
const pendingDeleteReqId = ref<number | null>(null)
const deletingRequirement = ref(false)
const creatingTasksBatchId = ref<number | null>(null)
const showBaselineConfirmModal = ref(false)
const pendingBaselineReviewIds = ref<number[]>([])
const pendingBaselineRemainingCount = ref(0)

function mapListRequirementToReviewBrief(requirement: typeof items.value[number]): ReviewBatchRequirement {
  return {
    id: requirement.id,
    itemKind: requirement.itemKind,
    parentRequirementId: requirement.parentRequirementId,
    milestoneId: requirement.milestoneId,
    milestoneName: requirement.milestoneName,
    reqCode: requirement.reqCode,
    title: requirement.title,
    status: requirement.status,
    priority: requirement.priority,
    changeReason: requirement.changeReason,
    scopeNote: requirement.scopeNote
  }
}

function resolveBatchRequirements(batch: ReviewBatch): ReviewBatchRequirement[] {
  if (batch.requirements.length > 0) return batch.requirements

  const listRequirementMap = new Map(items.value.map(requirement => [requirement.id, requirement]))
  return batch.requirementIds
    .map(reqId => listRequirementMap.get(reqId))
    .filter((requirement): requirement is typeof items.value[number] => !!requirement)
    .map(mapListRequirementToReviewBrief)
}

const activeBatchRequirementRows = computed(() => {
  const batch = activeBatch.value
  if (!batch) return []
  const batchRequirementMap = new Map(resolveBatchRequirements(batch).map(requirement => [requirement.id, requirement]))
  return batch.requirementIds.map((reqId) => {
    const batchRequirement = batchRequirementMap.get(reqId)
    return {
      reqId,
      requirement: batchRequirement || null
    }
  })
})

async function fetchBatches() {
  try {
    const res = await $fetch<{ code: number, data: { batches?: ReviewBatch[], items?: Record<string, unknown>[] } }>(
      `/api/v1/projects/${projectId.value}/requirement-reviews`
    )
    if (res.code === 0) {
      batches.value = Array.isArray(res.data.batches)
        ? res.data.batches
        : (res.data.items || []).map(normalizeReviewBatch)

      const routeBatchId = route.query.batchId ? Number(route.query.batchId) : null
      const routeBatch = routeBatchId && !Number.isNaN(routeBatchId)
        ? batches.value.find(b => b.id === routeBatchId)
        : null
      if (routeBatch) {
        activeBatchId.value = routeBatch.id
        await nextTick()
        await fetchActiveBatchDiffs()
        return
      }

      const selectedStillExists = activeBatchId.value
        ? batches.value.some(b => b.id === activeBatchId.value)
        : false
      if (!selectedStillExists) {
        const pendingBatch = batches.value.find(b => b.status === 'pending')
        activeBatchId.value = pendingBatch?.id ?? null
      }
      await nextTick()
      await fetchActiveBatchDiffs()
    }
  } catch (err) {
    console.error('[fetchBatches] failed:', err)
  }
}

function normalizeReviewBatch(item: Record<string, unknown>): ReviewBatch {
  const requirementIds = parseRequirementIds(item.requirementIds ?? item.requirement_ids_json)
  return {
    id: Number(item.id) || 0,
    batchType: String((item.batchType ?? item.batch_type) || 'baseline') as ReviewBatch['batchType'],
    title: String(item.title || ''),
    description: item.description ? String(item.description) : null,
    requirementIds,
    requirements: [],
    status: String(item.status || 'pending') as ReviewBatch['status'],
    workflowInstanceId: item.workflowInstanceId || item.workflow_instance_id ? String(item.workflowInstanceId ?? item.workflow_instance_id) : null,
    submittedBy: String((item.submittedBy ?? item.submitted_by) || ''),
    submittedAt: String((item.submittedAt ?? item.submitted_at) || ''),
    closedAt: item.closedAt || item.closed_at ? String(item.closedAt ?? item.closed_at) : null
  }
}

function parseRequirementIds(value: unknown) {
  if (Array.isArray(value)) return value.map(item => Number(item)).filter(Number.isFinite)
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(item => Number(item)).filter(Number.isFinite) : []
  } catch {
    return []
  }
}

async function fetchActiveBatchDiffs() {
  const batch = activeBatch.value
  if (!batch || batch.batchType !== 'change') {
    changeDiffs.value = {}
    return
  }
  const changeReqs = batch.requirements.filter(req => req.itemKind === 'change')
  const entries = await Promise.all(changeReqs.map(async (req) => {
    try {
      const res = await $fetch<ChangeDiffResponse>(`/api/v1/requirements/${req.id}/change-diff`)
      return [req.id, res.data] as const
    } catch (err) {
      console.warn('[fetchChangeDiff] failed:', err)
      return null
    }
  }))
  changeDiffs.value = Object.fromEntries(entries.filter((entry): entry is readonly [number, ChangeDiffResponse['data']] => !!entry))
}

watch(activeBatchId, () => {
  fetchActiveBatchDiffs()
})

const toast = useToast()

onMounted(async () => {
  // 先拉里程碑，再拉 targets，以便默认选中"当前里程碑"的第一个 requirement target
  await milestoneStore.fetchMilestones(projectId.value)
  await fetchRequirementTargets()
  await Promise.all([
    fetchList(),
    fetchSpecByVisibility(),
    fetchBatches()
  ])

  if (!routeTab && total.value === 0) {
    activeTab.value = 'spec'
  }

  // Deep-link from approval center: ?batchId=xxx (activeTab already set from initialTab)
  const routeBatchId = route.query.batchId
  if (routeBatchId) {
    const id = Number(routeBatchId)
    if (!Number.isNaN(id)) {
      await nextTick()
      activeBatchId.value = id
    }
  }
})

const statusLabel: Record<string, string> = {
  draft: '草稿',
  in_review: '评审中',
  baselined: '已基线',
  change_pending: '变更中',
  deprecated: '已废弃'
}

const statusColor: Record<string, string> = {
  draft: 'neutral',
  in_review: 'warning',
  baselined: 'success',
  change_pending: 'info',
  deprecated: 'error'
}

const typeLabel: Record<string, string> = {
  functional: '功能',
  non_functional: '非功能'
}

const priorityColor: Record<string, string> = {
  P0: 'error',
  P1: 'warning',
  P2: 'info',
  P3: 'neutral'
}

function openDetail(reqId: number) {
  activeReqId.value = reqId
  showDetailModal.value = true
}

async function handleCreateRequirement() {
  showCreateRequirementModal.value = true
}

async function handleRequirementCreated() {
  showCreateRequirementModal.value = false
  checkedChapterIds.value = new Set()
  clickedChapterId.value = null
  await Promise.all([fetchSpecByVisibility(), fetchList(), fetchRequirementTargets()])
}

function requestDeleteRequirement(reqId: number) {
  pendingDeleteReqId.value = reqId
  showDeleteModal.value = true
}

async function handleDelete() {
  if (!pendingDeleteReqId.value || deletingRequirement.value) return
  deletingRequirement.value = true
  try {
    await $fetch(`/api/v1/requirements/${pendingDeleteReqId.value}`, { method: 'DELETE' })
    toast.add({ title: '操作成功', color: 'success' })
    selectedReqs.value = selectedReqs.value.filter(id => id !== pendingDeleteReqId.value)
    await Promise.all([fetchList(), fetchSpecByVisibility(), fetchRequirementTargets()])
    showDeleteModal.value = false
    pendingDeleteReqId.value = null
  } catch {
    toast.add({ title: '操作失败', color: 'error' })
  } finally {
    deletingRequirement.value = false
  }
}

function toggleSelect(id: number) {
  const idx = selectedReqs.value.indexOf(id)
  if (idx >= 0) {
    selectedReqs.value.splice(idx, 1)
  } else {
    selectedReqs.value.push(id)
  }
}

function toggleSelectAll() {
  if (selectedReqs.value.length === items.value.length) {
    selectedReqs.value = []
  } else {
    selectedReqs.value = items.value.map(i => i.id)
  }
}

// Spec view: click = single select (full view), checkbox = multi-select within same parent module
const checkedChapterIds = ref<Set<number>>(new Set())
const clickedChapterId = ref<number | null>(null)

interface AnyNode { id: number, requirementId: number | null, children: AnyNode[], parentId?: number | null, headingDepth?: number }

function flattenTree(nodes: typeof contentTree.value): typeof contents.value {
  const result: typeof contents.value = []
  for (const n of nodes) {
    result.push(n as typeof contents.value[0])
    if ('children' in n && Array.isArray(n.children)) {
      result.push(...flattenTree(n.children as typeof contentTree.value))
    }
  }
  return result
}

function findNode(id: number): AnyNode | null {
  const all = flattenTree(contentTree.value)
  return (all.find(n => n.id === id) as AnyNode | undefined) || null
}

function findRawNode(id: number): typeof contents.value[0] | null {
  return contents.value.find(c => c.id === id) || null
}

const linkedRequirementCreatedAtMap = computed(() => {
  const map = new Map<number, string>()
  for (const requirement of linkedRequirements.value) {
    map.set(requirement.id, requirement.createdAt)
  }
  return map
})

function isDetachedFromRequirement(node: typeof contents.value[number], requirementId: number | null | undefined): boolean {
  if (!requirementId || node.requirementId != null) return false
  const requirementCreatedAt = linkedRequirementCreatedAtMap.value.get(requirementId)
  if (!requirementCreatedAt || !node.createdAt) return false
  const nodeTs = Date.parse(node.createdAt)
  const reqTs = Date.parse(requirementCreatedAt)
  if (Number.isNaN(nodeTs) || Number.isNaN(reqTs)) return false
  return nodeTs > reqTs
}

function findBlockingAncestorRequirementId(node: typeof contents.value[number]): number | null {
  let currentId = node.parentId
  while (currentId) {
    const current = findRawNode(currentId)
    if (!current) return null
    if (current.requirementId != null) {
      return isDetachedFromRequirement(node, current.requirementId) ? null : current.requirementId
    }
    currentId = current.parentId ?? null
  }
  return null
}

function hasDeprecatedAncestor(node: typeof contents.value[number]): boolean {
  let currentId = node.parentId
  while (currentId) {
    const current = findRawNode(currentId)
    if (!current) return false
    if (current.status === 'deprecated') return true
    currentId = current.parentId ?? null
  }
  return false
}

function getSelectableDescendantIds(node: AnyNode): number[] {
  const result: number[] = []

  const walk = (nodes: AnyNode[]) => {
    for (const child of nodes) {
      const rawChild = findRawNode(child.id)
      if (rawChild?.status === 'deprecated') continue
      if (child.requirementId != null) continue
      if (child.children.length === 0) {
        result.push(child.id)
      } else {
        walk(child.children)
      }
    }
  }

  walk(node.children)
  return result
}

function isModuleFullySelected(node: AnyNode, selection: Set<number>): boolean {
  const selectableDescendantIds = getSelectableDescendantIds(node)
  return selectableDescendantIds.length > 0
    && selectableDescendantIds.every(childId => selection.has(childId))
}

// legacy toggle kept for reference but not used

function _legacyToggleChapter(id: number) {
  const newSet = new Set(checkedChapterIds.value)
  const node = findNode(id)
  const rawNode = findRawNode(id)

  if (rawNode?.parentId) {
    const parent = findRawNode(rawNode.parentId)
    if (parent && parent.requirementId != null) {
      return
    }
  }

  const isModule = node && node.children.length > 0

  if (isModule) {
    const selectableDescendantIds = getSelectableDescendantIds(node!)
    if (selectableDescendantIds.length === 0) {
      return
    }

    const allSelectableChecked = isModuleFullySelected(node!, newSet)

    if (allSelectableChecked) {
      for (const childId of selectableDescendantIds) newSet.delete(childId)
    } else {
      newSet.clear()
      for (const childId of selectableDescendantIds) newSet.add(childId)
    }
  } else if (newSet.has(id)) {
    newSet.delete(id)
  } else {
    // Leaf: sibling-only rule
    if (newSet.size > 0) {
      const firstCheckedId = newSet.values().next().value
      if (firstCheckedId !== undefined) {
        const firstChecked = findRawNode(firstCheckedId)
        const myParentId = rawNode?.parentId ?? null
        if (firstChecked) {
          const firstIsModule = firstChecked.parentId == null
          if (firstIsModule && firstChecked.id !== myParentId) {
            newSet.clear()
          } else if (!firstIsModule && firstChecked.parentId !== myParentId) {
            const toast = useToast()
            toast.add({ title: '只能勾选同一模块下的功能项', color: 'warning' })
            return
          }
        }
      }
    }
    newSet.add(id)
  }
  checkedChapterIds.value = newSet
  clickedChapterId.value = null
}

let justClickedFlag = false
let justClickedTimer: ReturnType<typeof setTimeout> | null = null

function clickChapter(id: number) {
  const rawNode = findRawNode(id)
  if (!rawNode) return

  justClickedFlag = true
  if (justClickedTimer) clearTimeout(justClickedTimer)
  justClickedTimer = setTimeout(() => {
    justClickedFlag = false
  }, 100)

  // If clicked node is bound to a requirement, toggle view mode
  if (rawNode.requirementId != null) {
    if (clickedChapterId.value === id) {
      clickedChapterId.value = null
    } else {
      checkedChapterIds.value = new Set()
      clickedChapterId.value = id
    }
    return
  }

  if (rawNode.status === 'deprecated') {
    if (clickedChapterId.value === id) {
      clickedChapterId.value = null
    } else {
      checkedChapterIds.value = new Set()
      clickedChapterId.value = id
    }
    return
  }

  // Unbound: compute the "expected" selection for this click
  const treeNode = findNode(id)
  const isModule = treeNode && treeNode.children.length > 0
  const expectedSet = new Set<number>()
  if (isModule) {
    expectedSet.add(id)
    for (const c of treeNode!.children) {
      const rawChild = findRawNode(c.id)
      if (c.requirementId == null && rawChild?.status !== 'deprecated') expectedSet.add(c.id)
    }
  } else {
    expectedSet.add(id)
  }

  // If current checkedIds matches expectedSet exactly → toggle off
  const current = checkedChapterIds.value
  const same = current.size === expectedSet.size
    && [...current].every(x => expectedSet.has(x))
  checkedChapterIds.value = same ? new Set() : expectedSet
  clickedChapterId.value = null
}

// Handle spec update: preserve selection when it's just an edit; clear selection when req state changes
function handleSpecUpdated(reason?: 'edit' | 'req' | 'structure') {
  if (reason === 'edit') {
    fetchSpecByVisibility()
    return
  }
  if (reason === 'structure') {
    fetchSpecByVisibility()
    checkedChapterIds.value = new Set()
    clickedChapterId.value = null
    return
  }
  Promise.all([fetchSpecByVisibility(), fetchList(), fetchRequirementTargets()])
  checkedChapterIds.value = new Set()
  clickedChapterId.value = null
}

// Handle checkbox changes from UTree (handles propagate/bubble automatically)
function handleCheckedIdsChange(rawIds: Set<number>) {
  // Ignore UTree's selection updates that are triggered by a row click (label click).
  // The @select handler already set clickedChapterId; don't override it.
  if (justClickedFlag) {
    return
  }
  // Filter out:
  // 1. Items already linked to a requirement
  // 2. Items whose ancestor module is linked to a requirement (locked)
  const newIds = new Set<number>()
  for (const id of rawIds) {
    const node = findRawNode(id)
    if (!node) continue
    if (node.status === 'deprecated') continue
    if (node.requirementId != null) continue
    if (findBlockingAncestorRequirementId(node) != null) continue
    if (hasDeprecatedAncestor(node)) continue
    newIds.add(id)
  }

  // 跨模块限制：按树结构判定，不依赖 HTML 标题级别（H2/H3/H4）
  //   模块 = 有子节点的任何节点；自身是模块 → groupKey 为自己
  //   叶子 → groupKey 为其直接父节点（即所属模块）
  const resolveGroupKey = (id: number): number => {
    const node = findNode(id)
    if (!node) return id
    const hasChildren = Array.isArray(node.children) && node.children.length > 0
    if (hasChildren) return id
    return node.parentId ?? id
  }

  if (newIds.size > 0) {
    const moduleGroups = new Map<number | null, number[]>()
    for (const id of newIds) {
      const g = resolveGroupKey(id)
      if (!moduleGroups.has(g)) moduleGroups.set(g, [])
      moduleGroups.get(g)!.push(id)
    }
    if (moduleGroups.size > 1) {
      // 多于一个模块组：保留本次新加入的那个模块组，丢弃其它
      const prev = checkedChapterIds.value
      const newlyAdded = [...newIds].filter(id => !prev.has(id))
      if (newlyAdded.length > 0) {
        const keepId = newlyAdded[0]!
        const keepGroup = resolveGroupKey(keepId)
        const filtered = new Set<number>()
        for (const id of newIds) {
          if (resolveGroupKey(id) === keepGroup) filtered.add(id)
        }
        checkedChapterIds.value = filtered
        clickedChapterId.value = null
        return
      }
    }
  }

  checkedChapterIds.value = newIds
  // Only clear click selection when we actually have checkbox selections
  if (newIds.size > 0) {
    clickedChapterId.value = null
  }
}

// When clicking a node linked to a requirement, highlight all nodes sharing that requirement
const highlightReqId = computed(() => {
  if (clickedChapterId.value == null) return null
  const all = flattenTree(contentTree.value)
  const clicked = all.find(c => c.id === clickedChapterId.value)
  return (clicked as AnyNode | undefined)?.requirementId ?? null
})

// Display mode
const displayMode = computed<'checkbox' | 'click' | 'none'>(() => {
  if (checkedChapterIds.value.size > 0) return 'checkbox'
  if (clickedChapterId.value != null) return 'click'
  return 'none'
})

// Chapters to display on the right
const displayChapters = computed(() => {
  const all = flattenTree(contentTree.value)
  if (displayMode.value === 'checkbox') {
    const checkedList = all.filter(c => checkedChapterIds.value.has(c.id))
    // Find an integral module: all non-req descendants selected, no other items selected.
    // Exclude modules that already have any child with a requirement (can't be set as integral req).
    const exactModule = all.find((c) => {
      const node = c as unknown as AnyNode
      if (node.children.length === 0) return false
      // If module already has req children, it can't be set as integral requirement
      if (node.children.some((child: AnyNode) => child.requirementId != null)) return false
      const descendants = getSelectableDescendantIds(node)
      if (descendants.length === 0) return false
      if (!descendants.every(id => checkedChapterIds.value.has(id))) return false
      const descSet = new Set(descendants)
      for (const id of checkedChapterIds.value) {
        if (id !== node.id && !descSet.has(id)) return false
      }
      return true
    })
    if (exactModule) return [exactModule]
    // Otherwise: exclude module entries from the list (only show leaves)
    return checkedList.filter(c => (c as unknown as AnyNode).children.length === 0)
  }
  if (displayMode.value === 'click' && clickedChapterId.value != null) {
    const clicked = all.find(c => c.id === clickedChapterId.value)
    if (!clicked) return []
    // If clicked node has a requirement, show all chapters sharing that requirement
    const reqId = (clicked as unknown as AnyNode).requirementId
    if (reqId) {
      return all.filter(c => (c as unknown as AnyNode).requirementId === reqId)
    }
    return [clicked]
  }
  return []
})

// Whether currently viewing a requirement (for showing unset button)
const viewingReqId = computed(() => {
  if (displayMode.value !== 'click') return null
  return highlightReqId.value
})

// Is "partial" mode: parent checked but some children are requirements
const isPartialMode = computed(() => {
  if (displayMode.value !== 'checkbox') return false
  const all = flattenTree(contentTree.value) as unknown as AnyNode[]
  for (const node of all) {
    if (node.children.length === 0) continue
    const selectableDescendantIds = getSelectableDescendantIds(node)
    if (selectableDescendantIds.length === 0) continue
    const checkedCount = selectableDescendantIds.filter(childId => checkedChapterIds.value.has(childId)).length
    if (checkedCount > 0 && checkedCount < selectableDescendantIds.length) {
      return true
    }
  }
  return false
})

// For highlight: single click takes priority visually
const activeSelectedId = computed(() => {
  if (checkedChapterIds.value.size > 0) return null
  return clickedChapterId.value
})

const selectedContentIdForCreateRequirement = computed<number | null>(() => {
  if (clickedChapterId.value != null) {
    const clicked = findRawNode(clickedChapterId.value)
    if (clicked && clicked.status !== 'deprecated') return clickedChapterId.value
  }
  const firstCheckedId = checkedChapterIds.value.values().next().value
  return typeof firstCheckedId === 'number' ? firstCheckedId : null
})

watch(showDeletedContents, () => {
  checkedChapterIds.value = new Set()
  clickedChapterId.value = null
  fetchSpecByVisibility()
})

watch(contents, (list) => {
  const validIds = new Set(list.map(item => item.id))
  if (clickedChapterId.value != null && !validIds.has(clickedChapterId.value)) {
    clickedChapterId.value = null
  }
  let changed = false
  const nextChecked = new Set<number>()
  for (const id of checkedChapterIds.value) {
    if (validIds.has(id)) {
      nextChecked.add(id)
    } else {
      changed = true
    }
  }
  if (changed) {
    checkedChapterIds.value = nextChecked
  }
})

// ========================
// Workflow integration (baseline & change review)
// ========================
const projectStore = useProjectStore()
const { isPostInitiation, workItemReadonlyReason } = storeToRefs(projectStore)

// 当前选中的 target 是否为"基线 target"（项目内唯一，由模板预置）
const activeTargetIsBaseline = computed(() => !!activeTarget.value?.isBaseline)
// 基线 target 已锁定：首轮基线评审通过后 status 置为 completed
const activeTargetLocked = computed(() => activeTarget.value?.status === 'completed')
// 规格书导入 / 从规格书新增需求 仅在"基线 target 且未锁定"时允许
const canEditSpec = computed(() => activeTargetIsBaseline.value && !activeTargetLocked.value)
const activeMilestone = computed(() => milestoneStore.milestones.find(m => m.status === 'active') || null)

const draftSelected = computed(() => {
  return selectedReqs.value.filter(id =>
    items.value.find(i => i.id === id && i.itemKind === 'baseline' && i.status === 'draft')
  )
})

const changeSelected = computed(() => {
  return selectedReqs.value.filter(id =>
    items.value.find(i => i.id === id && i.itemKind === 'change' && i.status === 'draft')
  )
})
const hasProjectBaseline = computed(() => baselineSummary.value.baselinedCount > 0)
const pendingBaselineBatch = computed(() =>
  batches.value.find(b => b.batchType === 'baseline' && b.status === 'pending') || null
)
const pendingBaselineBatchUnsubmitted = computed(() =>
  !!pendingBaselineBatch.value && !pendingBaselineBatch.value.workflowInstanceId
)
const pendingBaselineBatchSubmitted = computed(() =>
  !!pendingBaselineBatch.value && !!pendingBaselineBatch.value.workflowInstanceId
)
// 'baseline'        => 首次准备基线评审（无任何基线 / 无进行中的基线批次）
// 'append-baseline' => 并入现有"已准备未提交审批"的基线批次
// 'next-baseline'   => 准备"变更评审"（项目已有基线，或前一基线批次已提交审批），新建续批基线批次
// 'change'          => 变更需求（item_kind=change）的变更评审
// 'mixed' / 'none'  => 不可批量操作
const selectedReviewKind = computed<'baseline' | 'append-baseline' | 'next-baseline' | 'change' | 'mixed' | 'none'>(() => {
  if (selectedReqs.value.length === 0) return 'none'
  const allDraftBaseline = draftSelected.value.length === selectedReqs.value.length
  const allDraftChange = changeSelected.value.length === selectedReqs.value.length
  if (allDraftBaseline) {
    if (pendingBaselineBatchUnsubmitted.value) return 'append-baseline'
    if (pendingBaselineBatchSubmitted.value || hasProjectBaseline.value) return 'next-baseline'
    return 'baseline'
  }
  if (allDraftChange) return 'change'
  return 'mixed'
})

const taskActionsResolved = ref(true)
const taskActions = ref<Array<{ taskId: number, action: string }>>([])

function handleTaskImpactResolved(actions: Array<{ taskId: number, action: string }>) {
  taskActions.value = actions
  taskActionsResolved.value = true
}

const showChangePanel = ref(false)

function getBatchAction(batch: ReviewBatch) {
  return batch.batchType === 'baseline'
    ? {
        actionCode: 'requirement_baseline',
        actionName: '需求基线评审',
        icon: 'i-lucide-clipboard-check'
      }
    : {
        actionCode: 'requirement_change',
        actionName: '需求变更评审',
        icon: 'i-lucide-file-pen-line'
      }
}

function getPendingBatchMilestoneIssues(batch: ReviewBatch): string[] {
  const issues: string[] = []
  const currentMilestone = activeMilestone.value
  if (!currentMilestone) {
    issues.push('当前没有活动里程碑，暂不可提交需求评审')
    return issues
  }

  const requirements = resolveBatchRequirements(batch)
  if (batch.requirementIds.length === 0) {
    issues.push('该评审批次没有关联需求项')
    return issues
  }

  if (requirements.length !== batch.requirementIds.length) {
    issues.push('部分批次需求未加载完成，请刷新后重试')
    return issues
  }

  const missingMilestoneReqs = requirements.filter(requirement => requirement.milestoneId == null)
  if (missingMilestoneReqs.length > 0) {
    const sample = missingMilestoneReqs.slice(0, 3).map(requirement => requirement.reqCode).join('、')
    const suffix = missingMilestoneReqs.length > 3 ? ` 等 ${missingMilestoneReqs.length} 条` : ''
    issues.push(`批次中有需求未绑定里程碑（${sample}${suffix}），无法提交审批`)
  }

  const milestoneMap = new Map<number, string>()
  for (const requirement of requirements) {
    if (requirement.milestoneId == null) continue
    if (!milestoneMap.has(requirement.milestoneId)) {
      milestoneMap.set(requirement.milestoneId, requirement.milestoneName || `里程碑#${requirement.milestoneId}`)
    }
  }

  if (milestoneMap.size > 1) {
    issues.push(`当前批次包含多个里程碑的需求（${Array.from(milestoneMap.values()).join('、')}），仅允许提交当前活动里程碑的评审批次`)
  } else if (milestoneMap.size === 1) {
    const [milestoneId, milestoneName] = Array.from(milestoneMap.entries())[0]!
    if (milestoneId !== currentMilestone.id) {
      issues.push(`仅当前活动里程碑「${currentMilestone.name}」的需求评审批次允许提交，当前批次属于「${milestoneName}」`)
    }
  }

  return issues
}

function getSelectionMilestoneIssues(requirementIds: number[]): string[] {
  const issues: string[] = []
  const currentMilestone = activeMilestone.value
  if (!currentMilestone) {
    issues.push('当前没有活动里程碑，暂不可创建需求评审批次')
    return issues
  }

  const selectedRequirements = requirementIds
    .map(id => items.value.find(item => item.id === id) || null)
    .filter((item): item is typeof items.value[number] => !!item)

  if (selectedRequirements.length !== requirementIds.length) {
    issues.push('部分已选需求未加载完成，请刷新后重试')
    return issues
  }

  const missingMilestoneReqs = selectedRequirements.filter(requirement => requirement.milestoneId == null)
  if (missingMilestoneReqs.length > 0) {
    const sample = missingMilestoneReqs.slice(0, 3).map(requirement => requirement.reqCode).join('、')
    const suffix = missingMilestoneReqs.length > 3 ? ` 等 ${missingMilestoneReqs.length} 条` : ''
    issues.push(`所选需求中有未绑定里程碑的项（${sample}${suffix}），无法创建评审批次`)
  }

  const milestoneMap = new Map<number, string>()
  for (const requirement of selectedRequirements) {
    if (requirement.milestoneId == null) continue
    if (!milestoneMap.has(requirement.milestoneId)) {
      milestoneMap.set(requirement.milestoneId, requirement.milestoneName || `里程碑#${requirement.milestoneId}`)
    }
  }

  if (milestoneMap.size > 1) {
    issues.push(`所选需求包含多个里程碑（${Array.from(milestoneMap.values()).join('、')}），仅允许创建当前活动里程碑的评审批次`)
  } else if (milestoneMap.size === 1) {
    const [milestoneId, milestoneName] = Array.from(milestoneMap.entries())[0]!
    if (milestoneId !== currentMilestone.id) {
      issues.push(`仅当前活动里程碑「${currentMilestone.name}」的需求可创建评审批次，当前选择属于「${milestoneName}」`)
    }
  }

  return issues
}

async function syncBatchWorkflow(batchId: number) {
  try {
    await $fetch(`/api/v1/requirement-reviews/${batchId}/sync-workflow`, { method: 'POST' })
  } catch (err) {
    console.warn('[syncBatchWorkflow] failed:', err)
  } finally {
    await fetchBatches()
    activeBatchId.value = batchId
  }
}

// ========== 页面级流程声明：需求基线/变更评审 ==========
usePageWorkflow({
  appCode: 'aims',
  resourceCode: 'requirements',
  bizId: computed(() => activeTab.value === 'review' && activeBatch.value?.status === 'pending' ? String(activeBatch.value.id) : ''),
  bizTitle: computed(() => activeTab.value === 'review' ? (activeBatch.value?.title || '') : ''),
  bizUrl: computed(() => {
    if (activeTab.value !== 'review' || !activeBatch.value) return ''
    return resolveCurrentAppUrl(`/projects/${projectId.value}/requirements?tab=review&batchId=${activeBatch.value.id}`)
  }),
  bizContext: computed(() => ({
    project_id: projectId.value
  })),
  actions: computed(() => {
    if (activeTab.value !== 'review') return []
    const batch = activeBatch.value
    if (!batch || batch.status !== 'pending') return []

    const action = getBatchAction(batch)
    const issues = computed(() => {
      const list: string[] = []
      list.push(...getPendingBatchMilestoneIssues(batch))
      // 首轮基线评审：项目下仍有未纳入本批次的草稿基线需求，不允许提交
      if (batch.batchType === 'baseline'
        && !hasProjectBaseline.value
        && baselineSummary.value.draftCount > 0) {
        list.push(`项目仍有 ${baselineSummary.value.draftCount} 条草稿基线需求未纳入本批次，请先并入或删除后再提交`)
      }
      return list
    })

    return [{
      ...action,
      canSubmit: computed(() => issues.value.length === 0),
      completenessIssues: issues,
      async onSubmitted() {
        await syncBatchWorkflow(batch.id)
        toast.add({ title: '需求评审已提交审批', color: 'success' })
      },
      async onApproved() {
        try {
          await $fetch(`/api/v1/requirement-reviews/${batch.id}/approve`, { method: 'POST' })
          toast.add({ title: `${action.actionName}已通过`, color: 'success' })
        } catch (err: unknown) {
          const msg = (err as { data?: { message?: string } })?.data?.message
            || (err as { message?: string })?.message
            || '评审通过回写失败'
          toast.add({ title: msg, color: 'error', duration: 6000 })
        } finally {
          await Promise.all([fetchBatches(), fetchList(), fetchSpecByVisibility(), fetchRequirementTargets()])
          activeBatchId.value = batch.id
        }
      },
      async onRejected() {
        try {
          await $fetch(`/api/v1/requirement-reviews/${batch.id}/reject`, { method: 'POST' })
          toast.add({ title: `${action.actionName}已驳回`, color: 'warning' })
        } catch (err: unknown) {
          const msg = (err as { data?: { message?: string } })?.data?.message
            || (err as { message?: string })?.message
            || '评审驳回回写失败'
          toast.add({ title: msg, color: 'error', duration: 6000 })
        } finally {
          await Promise.all([fetchBatches(), fetchList(), fetchSpecByVisibility(), fetchRequirementTargets()])
          activeBatchId.value = batch.id
        }
      }
    }]
  })
})

function requestWithdrawBatch(batchId: number) {
  pendingWithdrawBatchId.value = batchId
  showWithdrawModal.value = true
}

async function withdrawBatch() {
  if (!pendingWithdrawBatchId.value || withdrawingBatch.value) return
  withdrawingBatch.value = true
  try {
    await $fetch(`/api/v1/requirement-reviews/${pendingWithdrawBatchId.value}/withdraw`, { method: 'POST' })
    toast.add({ title: '已取消评审准备', color: 'success' })
    await Promise.all([fetchBatches(), fetchList(), fetchSpecByVisibility(), fetchRequirementTargets()])
    showWithdrawModal.value = false
    pendingWithdrawBatchId.value = null
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message
      || (err as { message?: string })?.message
      || '取消失败'
    toast.add({ title: msg, color: 'error' })
  } finally {
    withdrawingBatch.value = false
  }
}

async function resubmitBatch(batch: ReviewBatch) {
  // Re-submit a rejected batch as a new batch with same requirements
  const ids = batch.requirementIds
  if (ids.length === 0) {
    toast.add({ title: '该批次没有关联需求项，无法再次提交', color: 'error' })
    return
  }
  try {
    const res = await $fetch<{ code: number, data: { batchId: number, title: string } }>(
      `/api/v1/projects/${projectId.value}/requirement-reviews`,
      {
        method: 'POST',
        body: { batchType: batch.batchType, requirementIds: ids }
      }
    )
    if (res.code === 0) {
      toast.add({ title: `已重新准备评审: ${res.data.title}`, color: 'success' })
      await Promise.all([fetchBatches(), fetchList(), fetchSpecByVisibility(), fetchRequirementTargets()])
      await nextTick()
      activeBatchId.value = res.data.batchId
    }
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '重新准备失败'
    toast.add({ title: msg, color: 'error' })
  }
}

async function createTasksForBatch(batch: ReviewBatch) {
  if (creatingTasksBatchId.value) return
  creatingTasksBatchId.value = batch.id
  try {
    const res = await $fetch<{
      code: number
      data: {
        createdCount: number
        skippedCount: number
      }
    }>(`/api/v1/requirement-reviews/${batch.id}/create-tasks`, {
      method: 'POST'
    })

    const { createdCount, skippedCount } = res.data
    if (createdCount > 0 && skippedCount > 0) {
      toast.add({ title: `已生成 ${createdCount} 个规划中任务，跳过 ${skippedCount} 个`, color: 'warning' })
    } else if (createdCount > 0) {
      toast.add({ title: `已生成 ${createdCount} 个规划中任务`, color: 'success' })
    } else {
      toast.add({ title: '没有可新建的任务，所选需求可能已有关联任务', color: 'neutral' })
    }

    await Promise.all([fetchList(), fetchBatches(), fetchRequirementTargets()])
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message
      || (err as { message?: string })?.message
      || '批量生成任务失败'
    toast.add({ title: msg, color: 'error' })
  } finally {
    creatingTasksBatchId.value = null
  }
}

async function submitReviewFromList(batchType: 'baseline' | 'change') {
  const ids = batchType === 'baseline' ? draftSelected.value : changeSelected.value
  if (ids.length === 0) return

  const milestoneIssues = getSelectionMilestoneIssues(ids)
  if (milestoneIssues.length > 0) {
    toast.add({ title: milestoneIssues[0]!, color: 'warning', duration: 6000 })
    return
  }

  if (batchType === 'baseline' && pendingBaselineBatchUnsubmitted.value) {
    toast.add({ title: '存在尚未提交审批的基线评审批次，请选择"并入现有基线评审"', color: 'warning' })
    return
  }

  // 首次基线评审：若仍有草稿基线未纳入，提示用户确认是否分批
  const isInitialBaseline = batchType === 'baseline'
    && !hasProjectBaseline.value
    && !pendingBaselineBatchSubmitted.value
  const remainingDraftBaselineCount = Math.max(0, baselineSummary.value.draftCount - ids.length)
  if (isInitialBaseline && remainingDraftBaselineCount > 0) {
    pendingBaselineReviewIds.value = [...ids]
    pendingBaselineRemainingCount.value = remainingDraftBaselineCount
    showBaselineConfirmModal.value = true
    return
  }

  await submitReviewBatch(batchType, ids)
}

async function appendSelectedToPendingBaselineBatch() {
  const batch = pendingBaselineBatch.value
  if (!batch || batch.workflowInstanceId) return
  const ids = draftSelected.value
  if (ids.length === 0) return
  try {
    const res = await $fetch<{ code: number, data: { batchId: number, appendedCount: number } }>(
      `/api/v1/requirement-reviews/${batch.id}/append-requirements`,
      { method: 'POST', body: { requirementIds: ids } }
    )
    if (res.code === 0) {
      toast.add({ title: `已并入 ${res.data.appendedCount} 条需求到当前基线评审`, color: 'success' })
      selectedReqs.value = []
      await Promise.all([fetchBatches(), fetchList(), fetchSpecByVisibility(), fetchRequirementTargets()])
      activeBatchId.value = batch.id
    }
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message
      || (err as { message?: string })?.message
      || '并入基线评审失败'
    toast.add({ title: msg, color: 'error' })
  }
}

async function submitReviewBatch(batchType: 'baseline' | 'change', ids: number[]) {
  try {
    const res = await $fetch<{ code: number, data: { batchId: number, title: string } }>(
      `/api/v1/projects/${projectId.value}/requirement-reviews`,
      { method: 'POST', body: { batchType, requirementIds: ids } }
    )
    if (res.code === 0) {
      toast.add({ title: `已创建评审准备: ${res.data.title}`, color: 'success' })
      selectedReqs.value = []
      activeTab.value = 'review'
      await Promise.all([fetchBatches(), fetchList(), fetchSpecByVisibility(), fetchRequirementTargets()])
      await nextTick()
      activeBatchId.value = res.data.batchId
    }
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message
      || (err as { message?: string })?.message
      || '准备评审失败'
    toast.add({ title: msg, color: 'error' })
  }
}

async function confirmPartialBaselineReview() {
  if (pendingBaselineReviewIds.value.length === 0) return
  const ids = [...pendingBaselineReviewIds.value]
  showBaselineConfirmModal.value = false
  pendingBaselineReviewIds.value = []
  pendingBaselineRemainingCount.value = 0
  await submitReviewBatch('baseline', ids)
}

function cancelPartialBaselineReview() {
  showBaselineConfirmModal.value = false
  pendingBaselineReviewIds.value = []
  pendingBaselineRemainingCount.value = 0
}
</script>

<template>
  <UDashboardPanel
    id="requirements"
    :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }"
  >
    <template #body>
      <div class="flex flex-col h-full min-h-0">
        <ProjectNavbar />

        <!-- 需求工作项（基线/变更）切换条 -->
        <div
          v-if="requirementTargets.length > 0"
          class="flex items-center gap-2 px-5 pt-4 pb-1 border-b border-default bg-elevated/30"
        >
          <!-- <UIcon name="i-lucide-clipboard-list" class="w-4 h-4 text-muted" /> -->
          <!-- <span class="text-sm text-muted">批次：</span> -->
          <UButton
            :color="activeTargetId === null ? 'primary' : 'neutral'"
            :variant="activeTargetId === null ? 'soft' : 'ghost'"
            size="xs"
            icon="i-lucide-folders"
            @click="activeTargetId = null"
          >
            全部
            <UBadge
              color="neutral"
              variant="outline"
              size="xs"
              class="ml-1 font-mono"
            >
              {{ allRequirementCount }}
            </UBadge>
          </UButton>
          <UButton
            v-for="t in requirementTargets"
            :key="t.id"
            :color="(activeTargetId === t.id ? (t.isBaseline ? 'primary' : 'warning') : 'neutral') as any"
            :variant="activeTargetId === t.id ? 'soft' : 'ghost'"
            size="xs"
            @click="activeTargetId = t.id"
          >
            <UIcon
              :name="t.isBaseline ? 'i-lucide-anchor' : 'i-lucide-file-diff'"
              class="w-3.5 h-3.5 mr-1"
            />
            {{ t.title }}
            <UBadge
              color="neutral"
              variant="outline"
              size="xs"
              class="ml-1 font-mono"
            >
              T{{ t.taskCount }}/R{{ t.requirementCount }}
            </UBadge>
          </UButton>
          <span v-if="activeTarget" class="text-xs text-muted ml-auto">
            挂载里程碑：{{ activeTarget.milestoneName || '-' }}
            <span v-if="activeTarget.milestonePivrStage" class="font-mono ml-1">
              (PIVR:{{ activeTarget.milestonePivrStage }})
            </span>
          </span>
        </div>

        <div class="flex-1 min-h-0 flex flex-col">
          <UTabs
            v-model="activeTab"
            :items="requirementTabs"
            variant="link"
            size="sm"
            class="flex flex-col flex-1 min-h-0"
            :ui="{
              root: 'flex flex-col flex-1 min-h-0',
              list: 'px-4 py-1 border-b border-default rounded-none bg-transparent gap-1',
              trigger: 'grow-0',
              content: 'flex flex-col flex-1 min-h-0 focus:outline-none'
            }"
          >
            <template #list-trailing>
              <div
                v-if="activeTab === 'spec'"
                class="ml-auto flex items-center gap-2"
              >
                <div
                  v-if="spec"
                  class="flex items-center gap-1.5 mr-1"
                >
                  <USwitch
                    v-model="showDeletedContents"
                    size="sm"
                  />
                  <span class="text-xs text-muted">显示已删除</span>
                </div>
                <UButton
                  v-if="spec?.importStatus === 'imported_clean' || spec?.importStatus === 'imported_dirty'"
                  icon="i-lucide-download"
                  label="导出规格书"
                  color="neutral"
                  variant="soft"
                  size="sm"
                  :to="`/api/v1/projects/${projectId}/requirements/export?version=v1.0`"
                  external
                  target="_blank"
                />
                <UButton
                  v-if="isPostInitiation && canEditSpec && !hasGeneratedSpecRequirements && (!spec?.importStatus || spec.importStatus !== 'imported_locked')"
                  icon="i-lucide-upload"
                  :label="hasImportedSpec ? '重新导入' : '导入规格书'"
                  :color="hasImportedSpec ? 'neutral' : 'primary'"
                  :variant="hasImportedSpec ? 'soft' : 'solid'"
                  size="sm"
                  @click="onImportClick"
                />
                <UButton
                  v-if="isPostInitiation && canEditSpec"
                  icon="i-lucide-plus"
                  label="新增需求"
                  color="primary"
                  variant="soft"
                  size="sm"
                  @click="handleCreateRequirement"
                />
                <UBadge
                  v-if="isPostInitiation && !canEditSpec && activeTargetIsBaseline && activeTargetLocked"
                  color="success"
                  variant="soft"
                >
                  <UIcon name="i-lucide-lock" class="size-3 mr-1" />
                  基线已完成，如需调整请切换至需求变更批次
                </UBadge>
                <UBadge
                  v-else-if="isPostInitiation && activeTarget && !canEditSpec && !activeTargetIsBaseline"
                  color="info"
                  variant="soft"
                >
                  <UIcon name="i-lucide-file-diff" class="size-3 mr-1" />
                  当前为需求变更批次，不支持规格书导入
                </UBadge>
                <UBadge
                  v-if="!isPostInitiation && workItemReadonlyReason"
                  color="warning"
                  variant="soft"
                >
                  <UIcon name="i-lucide-lock" class="size-3 mr-1" />
                  {{ workItemReadonlyReason }}
                </UBadge>
              </div>
            </template>

            <template #spec>
              <!-- Spec View -->
              <div class="flex-1 min-h-0 overflow-y-auto pb-2 mb-2">
                <div
                  v-if="specLoading"
                  class="flex justify-center py-12"
                >
                  <UIcon
                    name="i-lucide-loader-2"
                    class="w-6 h-6 animate-spin text-muted"
                  />
                </div>
                <div
                  v-else-if="!spec || contents.length === 0"
                  class="text-center py-16 text-muted"
                >
                  <UIcon
                    name="i-lucide-book-open"
                    class="size-12 mx-auto mb-3"
                  />
                  <p class="text-base font-medium">
                    尚未导入需求规格书
                  </p>
                  <p class="text-sm mt-1">
                    请点击上方"导入规格书"按钮开始
                  </p>
                </div>
                <div
                  v-else
                  class="grid grid-cols-1 lg:grid-cols-[360px_1fr] h-full pb-2"
                >
                  <!-- Left: Chapter Tree -->
                  <div class="border-r border-default overflow-y-auto p-2 space-y-1">
                    <div class="text-xs font-semibold text-muted uppercase tracking-wider pl-3 mb-3">
                      章节目录 ({{ contents.length }})
                    </div>
                    <RequirementsSpecChapterTree
                      :nodes="(contentTree as any)"
                      :linked-requirements="linkedRequirements"
                      :checked-ids="checkedChapterIds"
                      :selected-id="activeSelectedId"
                      :highlight-req-id="highlightReqId"
                      @update:checked-ids="handleCheckedIdsChange"
                      @click="clickChapter"
                    />
                  </div>
                  <!-- Right: Chapter Preview (multi-select) -->
                  <div class="overflow-y-auto p-6">
                    <RequirementsSpecChapterPreview
                      :chapters="(displayChapters as any)"
                      :all-contents="flattenTree(contentTree) as any"
                      :linked-requirements="linkedRequirements"
                      :project-id="projectId"
                      :can-edit-spec="canEditSpec"
                      :can-set-requirement="displayMode === 'checkbox' && canEditSpec"
                      :is-partial="isPartialMode"
                      :viewing-req-id="viewingReqId"
                      :default-milestone-id="defaultImplMilestoneId"
                      :active-target-id="activeTargetId"
                      @updated="handleSpecUpdated"
                    />
                  </div>
                </div>
              </div>
            </template>

            <template #list>
              <!-- List View -->
              <div class="flex-1 min-h-0 flex flex-col">
                <!-- Filters -->
                <div class="flex items-center gap-3 px-6 py-3 flex-wrap">
                  <USelect
                    v-model="filters.type"
                    :items="[{ label: '全部类型', value: 'all' }, { label: '功能需求', value: 'functional' }, { label: '非功能需求', value: 'non_functional' }]"
                    size="sm"
                    class="w-28"
                  />
                  <USelect
                    v-model="filters.status"
                    :items="[{ label: '活跃', value: 'active' }, { label: '草稿', value: 'draft' }, { label: '已基线', value: 'baselined' }, { label: '评审中', value: 'in_review' }, { label: '全部', value: 'all' }]"
                    size="sm"
                    class="w-24"
                  />
                  <USelect
                    v-model="filters.priority"
                    :items="[{ label: '全部优先级', value: 'all' }, { label: 'P0', value: 'P0' }, { label: 'P1', value: 'P1' }, { label: 'P2', value: 'P2' }, { label: 'P3', value: 'P3' }]"
                    size="sm"
                    class="w-28"
                  />
                  <UInput
                    v-model="filters.search"
                    icon="i-lucide-search"
                    placeholder="搜索需求..."
                    size="sm"
                    class="w-48"
                  />
                  <div class="flex-1" />
                  <!-- Batch actions (when items selected) -->
                  <template v-if="selectedReqs.length > 0">
                    <UBadge
                      color="neutral"
                      variant="subtle"
                      size="xs"
                    >
                      已选 {{ selectedReqs.length }} 条
                    </UBadge>
                    <UButton
                      v-if="selectedReviewKind === 'baseline'"
                      icon="i-lucide-clipboard-check"
                      :label="`准备基线评审 (${draftSelected.length})`"
                      color="primary"
                      variant="soft"
                      size="xs"
                      @click="submitReviewFromList('baseline')"
                    />
                    <UButton
                      v-if="selectedReviewKind === 'append-baseline'"
                      icon="i-lucide-git-merge"
                      :label="`并入现有基线评审 (${draftSelected.length})`"
                      color="primary"
                      variant="soft"
                      size="xs"
                      @click="appendSelectedToPendingBaselineBatch"
                    />
                    <UButton
                      v-if="selectedReviewKind === 'next-baseline'"
                      icon="i-lucide-file-pen-line"
                      :label="`准备变更评审 (${draftSelected.length})`"
                      color="warning"
                      variant="soft"
                      size="xs"
                      @click="submitReviewFromList('baseline')"
                    />
                    <UButton
                      v-if="selectedReviewKind === 'change'"
                      icon="i-lucide-file-pen-line"
                      :label="`准备变更评审 (${changeSelected.length})`"
                      color="warning"
                      variant="soft"
                      size="xs"
                      @click="submitReviewFromList('change')"
                    />
                    <UButton
                      icon="i-lucide-x"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      @click="selectedReqs = []"
                    />
                  </template>
                  <div class="text-xs text-muted">
                    共 {{ total }} 条
                  </div>
                </div>

                <!-- Table -->
                <div class="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
                  <div
                    v-if="listLoading"
                    class="flex justify-center py-12"
                  >
                    <UIcon
                      name="i-lucide-loader-2"
                      class="w-6 h-6 animate-spin text-muted"
                    />
                  </div>
                  <div
                    v-else-if="items.length === 0"
                    class="text-center py-16 text-muted"
                  >
                    <UIcon
                      name="i-lucide-clipboard-list"
                      class="size-10 mx-auto mb-3"
                    />
                    <p>暂无需求项</p>
                  </div>
                  <table
                    v-else
                    class="w-full text-sm"
                  >
                    <thead>
                      <tr class="border-b border-default text-left text-xs text-muted uppercase tracking-wider">
                        <th class="py-2 pr-2 w-8">
                          <input
                            type="checkbox"
                            :checked="selectedReqs.length === items.length && items.length > 0"
                            @change="toggleSelectAll"
                          >
                        </th>
                        <th class="py-2 pr-4 w-40">
                          编号
                        </th>
                        <th class="py-2 pr-4">
                          标题
                        </th>
                        <th class="py-2 pr-4 w-16">
                          类型
                        </th>
                        <th class="py-2 pr-4 w-18">
                          优先级
                        </th>
                        <th class="py-2 pr-4 w-20">
                          状态
                        </th>
                        <th class="py-2 pr-4 w-24">
                          里程碑
                        </th>
                        <th class="py-2 pr-4 w-24">
                          关联任务
                        </th>
                        <th class="py-2 w-16">
                          操作
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="req in items"
                        :key="req.id"
                        class="border-b border-default hover:bg-elevated/50 cursor-pointer transition-colors"
                        @click="openDetail(req.id)"
                      >
                        <td
                          class="py-2.5 pr-2"
                          @click.stop
                        >
                          <input
                            type="checkbox"
                            :checked="selectedReqs.includes(req.id)"
                            @change="toggleSelect(req.id)"
                          >
                        </td>
                        <td class="py-2.5 pr-4 font-mono text-xs text-muted">
                          {{ req.reqCode }}
                        </td>
                        <td class="py-2.5 pr-4 font-medium truncate max-w-xs">
                          {{ req.title }}
                        </td>
                        <td class="py-2.5 pr-4">
                          <UBadge
                            :color="req.type === 'functional' ? 'primary' : 'secondary'"
                            variant="subtle"
                            size="xs"
                          >
                            {{ typeLabel[req.type] || req.type }}
                          </UBadge>
                        </td>
                        <td class="py-2.5 pr-4">
                          <UBadge
                            :color="(priorityColor[req.priority] as any)"
                            variant="subtle"
                            size="xs"
                          >
                            {{ req.priority }}
                          </UBadge>
                        </td>
                        <td class="py-2.5 pr-4">
                          <UBadge
                            :color="(statusColor[req.status] as any)"
                            variant="subtle"
                            size="xs"
                          >
                            {{ statusLabel[req.status] || req.status }}
                          </UBadge>
                        </td>
                        <td class="py-2.5 pr-4 text-xs text-muted truncate max-w-24">
                          {{ req.milestoneName || '-' }}
                        </td>
                        <td class="py-2.5 pr-4 text-xs font-mono">
                          {{ req.taskItemKey || '-' }}
                        </td>
                        <td
                          class="py-2.5"
                          @click.stop
                        >
                          <div class="flex items-center gap-0.5">
                            <UButton
                              v-if="req.status === 'baselined' && !req.taskItemKey"
                              icon="i-lucide-plus-square"
                              color="primary"
                              variant="ghost"
                              size="xs"
                              title="生成任务"
                              @click="openCreateTaskDialog(req)"
                            />
                            <UTooltip text="取消需求项">
                              <UButton
                                v-if="req.status !== 'baselined' && req.status !== 'in_review' && req.status !== 'change_pending'"
                                icon="i-lucide-undo-2"
                                color="error"
                                variant="ghost"
                                size="xs"
                                @click="requestDeleteRequirement(req.id)"
                              />
                            </UTooltip>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <!-- Change Impact Panel (appears when change review selected) -->
                <div
                  v-if="showChangePanel && changeSelected.length > 0"
                  class="border-t border-default px-6 py-4 bg-elevated/50"
                >
                  <RequirementsChangeTaskImpactPanel
                    :req-id="changeSelected[0]!"
                    @resolved="handleTaskImpactResolved"
                  />
                </div>
              </div>
            </template>

            <template #review>
              <!-- Review Tab -->
              <div class="flex-1 min-h-0 grid grid-cols-[280px_1fr]">
                <!-- Left: batch list -->
                <div class="border-r border-default overflow-y-auto p-3 space-y-2">
                  <div class="text-xs font-semibold text-muted uppercase tracking-wider mb-2 px-1">
                    评审批次 ({{ batches.length }})
                  </div>
                  <div
                    v-if="batches.length === 0"
                    class="text-center text-sm text-muted py-8"
                  >
                    暂无评审批次
                  </div>
                  <div
                    v-for="b in batches"
                    :key="b.id"
                    class="relative"
                  >
                    <button
                      class="w-full text-left p-3 rounded-lg border transition-colors cursor-pointer"
                      :class="activeBatchId === b.id ? 'border-primary bg-primary/5' : 'border-default hover:bg-elevated'"
                      @click="activeBatchId = b.id"
                    >
                      <div class="flex items-start justify-between gap-3 mb-1">
                        <div class="flex min-w-0 items-center gap-2">
                          <UBadge
                            :color="b.batchType === 'baseline' ? 'primary' : 'warning'"
                            variant="subtle"
                            size="xs"
                          >
                            {{ b.batchType === 'baseline' ? '基线' : '变更' }}
                          </UBadge>
                          <UBadge
                            :color="b.status === 'approved' ? 'success' : b.status === 'rejected' ? 'error' : (b.workflowInstanceId ? 'warning' : 'info')"
                            variant="subtle"
                            size="xs"
                          >
                            {{ b.status === 'pending'
                              ? (b.workflowInstanceId ? '评审中' : '待提交')
                              : ({ approved: '已通过', rejected: '已拒绝' } as Record<string, string>)[b.status] || b.status }}
                          </UBadge>
                        </div>
                        <UButton
                          v-if="b.status === 'approved'"
                          icon="i-lucide-plus-square"
                          :label="b.requirementIds.length > 1 ? '批量生成任务' : '生成任务'"
                          color="primary"
                          variant="soft"
                          size="xs"
                          class="shrink-0"
                          :loading="creatingTasksBatchId === b.id"
                          @click.stop="createTasksForBatch(b)"
                        />
                      </div>
                      <div class="text-sm font-medium truncate">
                        {{ b.title }}
                      </div>
                      <div class="text-xs text-muted mt-1">
                        {{ b.requirementIds.length }} 条需求 · {{ b.submittedAt?.slice(0, 16) }}
                      </div>
                    </button>
                  </div>
                </div>

                <!-- Right: batch details -->
                <div class="overflow-y-auto p-6">
                  <div
                    v-if="!activeBatch"
                    class="text-center text-muted py-16"
                  >
                    <UIcon
                      name="i-lucide-clipboard-check"
                      class="size-8 mx-auto mb-2"
                    />
                    <p>选择左侧批次查看详情并发起/处理审批</p>
                  </div>
                  <div v-else>
                    <div class="flex items-start justify-between gap-3 mb-2">
                      <h2 class="text-lg font-bold">
                        {{ activeBatch.title }}
                      </h2>
                      <UButton
                        v-if="activeBatch.status === 'pending' && !activeBatch.workflowInstanceId"
                        icon="i-lucide-undo-2"
                        label="取消评审准备"
                        color="neutral"
                        variant="soft"
                        size="xs"
                        @click="requestWithdrawBatch(activeBatch.id)"
                      />
                      <UButton
                        v-if="activeBatch.status === 'rejected'"
                        icon="i-lucide-refresh-cw"
                        label="重新准备评审"
                        color="primary"
                        variant="soft"
                        size="xs"
                        @click="resubmitBatch(activeBatch)"
                      />
                    </div>
                    <div class="flex items-center gap-2 mb-4 text-sm text-muted">
                      <span>提交人: {{ getUserName(activeBatch.submittedBy) }}</span>
                      <span>·</span>
                      <span>{{ activeBatch.submittedAt?.slice(0, 16) }}</span>
                      <span v-if="activeBatch.closedAt">·</span>
                      <span v-if="activeBatch.closedAt">关闭于 {{ activeBatch.closedAt.slice(0, 16) }}</span>
                    </div>
                    <div
                      v-if="activeBatch.description"
                      class="text-sm text-muted mb-4 p-3 bg-elevated rounded"
                    >
                      {{ activeBatch.description }}
                    </div>

                    <div class="text-sm font-semibold mb-2">
                      涉及需求 ({{ activeBatch.requirementIds.length }})
                    </div>
                    <div class="space-y-2">
                      <div
                        v-for="row in activeBatchRequirementRows"
                        :key="row.reqId"
                        class="flex items-center gap-3 p-2 rounded border border-default text-sm transition-colors"
                        :class="row.requirement ? 'cursor-pointer hover:bg-elevated/50' : ''"
                        @click="row.requirement && openDetail(row.reqId)"
                      >
                        <span class="font-mono text-xs text-muted">
                          {{ row.requirement?.reqCode || `#${row.reqId}` }}
                        </span>
                        <div class="min-w-0 flex-1">
                          <div class="truncate">
                            {{ row.requirement?.title || '需求项不存在' }}
                          </div>
                        </div>
                        <UBadge
                          v-if="row.requirement"
                          :color="({ draft: 'neutral', in_review: 'warning', baselined: 'success', change_pending: 'info', deprecated: 'error' } as any)[row.requirement.status]"
                          variant="subtle"
                          size="xs"
                        >
                          {{ ({ draft: '草稿', in_review: '评审中', baselined: '已基线', change_pending: '变更中', deprecated: '已废弃' } as any)[row.requirement.status] }}
                        </UBadge>
                      </div>
                    </div>

                    <div
                      v-if="activeBatch.batchType === 'change' && Object.keys(changeDiffs).length > 0"
                      class="mt-6 space-y-4"
                    >
                      <div class="text-sm font-semibold">
                        变更内容对比
                      </div>
                      <div
                        v-for="diff in Object.values(changeDiffs)"
                        :key="diff.requirement.id"
                        class="rounded-lg border border-default p-3 space-y-3"
                      >
                        <div class="flex items-center gap-2 text-sm">
                          <UBadge color="warning" variant="subtle">
                            {{ diff.requirement.reqCode }}
                          </UBadge>
                          <span class="text-muted">原需求</span>
                          <span class="font-mono text-xs text-muted">{{ diff.requirement.parentReqCode }}</span>
                          <span class="font-medium">{{ diff.requirement.parentTitle }}</span>
                        </div>
                        <div
                          v-if="activeBatch.requirements.find(req => req.id === diff.requirement.id)?.changeReason"
                          class="rounded bg-elevated px-3 py-2 text-sm"
                        >
                          <span class="font-medium">变更原因：</span>
                          {{ activeBatch.requirements.find(req => req.id === diff.requirement.id)?.changeReason }}
                        </div>
                        <div
                          v-for="item in diff.items"
                          :key="item.change.id"
                          class="rounded border border-default overflow-hidden"
                        >
                          <details :open="item.diffStatus !== 'unchanged'">
                            <summary class="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer bg-elevated/40">
                              <UBadge
                                :color="item.diffStatus === 'unchanged' ? 'neutral' : item.diffStatus === 'added' ? 'info' : 'warning'"
                                variant="subtle"
                                size="xs"
                              >
                                {{ item.diffStatus === 'unchanged' ? '未变化' : item.diffStatus === 'added' ? '新增' : '有变化' }}
                              </UBadge>
                              <span class="font-medium">{{ item.change.title }}</span>
                              <span class="text-muted">v{{ item.base?.versionNo || '-' }} → v{{ item.change.versionNo }}</span>
                            </summary>
                            <div class="grid grid-cols-1 xl:grid-cols-2 gap-3 p-3">
                              <div class="rounded border border-default p-3 bg-elevated/30">
                                <div class="text-xs font-semibold text-muted mb-2">
                                  当前版本 v{{ item.base?.versionNo || '-' }} · {{ item.base?.title || '-' }}
                                </div>
                                <pre class="text-xs whitespace-pre-wrap font-mono leading-relaxed">{{ item.base?.contentMd || '暂无内容' }}</pre>
                              </div>
                              <div class="rounded border border-warning/30 p-3 bg-warning/5">
                                <div class="text-xs font-semibold text-warning mb-2">
                                  变更版本 v{{ item.change.versionNo }} · {{ item.change.title }}
                                </div>
                                <pre class="text-xs whitespace-pre-wrap font-mono leading-relaxed">{{ item.change.contentMd || '暂无内容' }}</pre>
                              </div>
                            </div>
                          </details>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </UTabs>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <!-- Requirement Detail Modal -->
  <RequirementsDetailModal
    v-if="showDetailModal && activeReqId"
    :req-id="activeReqId"
    @close="showDetailModal = false"
  />

  <!-- 导入需求规格书：先选源文档 -->
  <AimsDocumentPicker
    v-model:open="showImportPicker"
    title="选择源文档（原始需求书）"
    :dept-code="projectStore.currentProject?.deptCode || null"
    :aims-project-id="projectId"
    :repos="projectStore.currentProject?.repos || []"
    default-source="repo"
    mode="snapshot"
    @select="onImportDocPicked"
  />

  <!-- 选中后进入导入向导（已带初始文档） -->
  <RequirementsImportWizard
    v-if="showImportModal"
    :project-id="projectId"
    :initial-doc-ref="importInitialDocRef"
    :work-item-id="activeTargetId"
    @close="showImportModal = false"
    @imported="showImportModal = false; fetchSpecByVisibility(); fetchList(); fetchRequirementTargets()"
  />

  <!-- Create Task Dialog -->
  <RequirementsTaskCreateTaskDialog
    v-if="createTaskReq"
    :requirement="(createTaskReq as any)"
    :project-id="projectId"
    :milestones="(milestoneStore.milestones as any)"
    :users="(accountUsers as any)"
    @close="createTaskReq = null"
    @created="createTaskReq = null; fetchList(); fetchRequirementTargets()"
  />

  <RequirementsSpecCreateRequirementModal
    v-if="showCreateRequirementModal"
    :project-id="projectId"
    :heading-levels="spec?.headingLevels || null"
    :contents="(contents as any)"
    :selected-content-id="selectedContentIdForCreateRequirement"
    :default-milestone-id="defaultImplMilestoneId"
    @close="showCreateRequirementModal = false"
    @created="handleRequirementCreated"
  />

  <UModal
    v-model:open="showWithdrawModal"
    title="取消评审准备"
    description="取消后，当前批次会被删除，关联需求会恢复到提交前状态。"
    :ui="{ content: 'sm:max-w-md' }"
  >
    <template #body>
      <div class="text-sm text-muted">
        确认要取消这次评审准备吗？
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="继续保留"
          color="neutral"
          variant="ghost"
          :disabled="withdrawingBatch"
          @click="showWithdrawModal = false"
        />
        <UButton
          label="确认取消"
          color="error"
          :loading="withdrawingBatch"
          @click="withdrawBatch"
        />
      </div>
    </template>
  </UModal>

  <UModal
    v-model:open="showDeleteModal"
    title="删除需求项"
    description="草稿需求会直接删除；非草稿需求会标记为已废弃。"
    :ui="{ content: 'sm:max-w-md' }"
  >
    <template #body>
      <div class="text-sm text-muted">
        确认继续吗？
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          :disabled="deletingRequirement"
          @click="showDeleteModal = false"
        />
        <UButton
          label="确认删除"
          color="error"
          :loading="deletingRequirement"
          @click="handleDelete"
        />
      </div>
    </template>
  </UModal>

  <UModal
    v-model:open="showBaselineConfirmModal"
    title="确认基线范围"
    :description="baselineSummary.baselinedCount === 0 ? '当前正在建立首个需求基线。' : '本次基线评审仍有未选需求项。'"
    :ui="{ content: 'sm:max-w-lg' }"
  >
    <template #body>
      <div class="space-y-3 text-sm">
        <p class="text-toned">
          本次仅选择了 {{ pendingBaselineReviewIds.length }} 条需求进入基线评审，仍有
          {{ pendingBaselineRemainingCount }} 条草稿需求未纳入本次基线。
        </p>
        <p
          v-if="baselineSummary.baselinedCount === 0"
          class="text-warning"
        >
          如果本次基线评审通过，这些未纳入需求后续只能作为“需求变更”提交评审。
        </p>
        <p
          v-else
          class="text-toned"
        >
          请确认这些未纳入需求是否需要留待后续单独评审。
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="返回补充选择"
          color="neutral"
          variant="ghost"
          @click="cancelPartialBaselineReview"
        />
        <UButton
          label="继续提交当前选中项"
          color="warning"
          @click="confirmPartialBaselineReview"
        />
      </div>
    </template>
  </UModal>
</template>
