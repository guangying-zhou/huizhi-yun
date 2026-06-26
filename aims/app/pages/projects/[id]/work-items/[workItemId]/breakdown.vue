<script setup lang="ts">
/**
 * 工作目标任务分解页面（重构版）
 *
 * 职责：
 *   - 目标信息区：只读展示（标题/描述/起止日期/控制工时/成果要求）
 *   - 任务分配区：统一模型
 *       * 多选项目成员 → 每个成员一张任务卡
 *       * 任务卡：描述、起止日期、计划工时、成果选择
 *       * 单成员：目标成果自动全选且不可取消
 *       * 多成员：各自勾选（code 类型允许多人重复选，其他类型单选）
 *       * 可追加任务自有成果（不来自目标）
 *   - 支持页面流程：
 *       * todo 阶段：确认/撤回任务分配
 *       * in_progress 阶段：确认完成评审（complete）
 */
import type { PivrStage, WorkItemType } from '~/types/aims'
import {
  typeConfig,
  priorityConfig,
  getStatusColor,
  getStatusLabel,
  deliverableTypeOptions,
  deliverableTypeLabel,
  deliverableTypeIcon,
  reviewLevelLabel,
  MULTI_ASSIGN_DELIVERABLE_TYPES
} from '~/config/work-item'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '任务分配',
  layoutHeaderProjectSwitcher: false
})

const { resolveCurrentAppUrl } = useAppUrls()

interface DeliverableItem {
  id: number
  entityType: string
  entityId: number
  name: string
  description: string | null
  acceptanceCriteria: string | null
  deliverableType: string
  required: boolean
  sortOrder?: number
  status: string
  documentUuid: string | null
  documentTitle?: string | null
  documentSource?: 'codocs' | 'repo'
  repoProjectCode?: string | null
  repoFilePath?: string | null
  repoCommitId?: string | null
  sourceDeliverableId?: number | null
  evidenceUrl: string | null
  evidenceNote: string | null
}

interface DocumentItem {
  id: number
  uuid: string
  title: string
  docCategory: string | null
  codocsUuid: string | null
  documentSource?: 'codocs' | 'repo'
  repoProjectCode?: string | null
  repoFilePath?: string | null
  repoCommitId?: string | null
  contentSize: number
  createdAt: string
  updatedAt: string
  milestoneId: number | null
  workItemId: number | null
  sourceStage: string | null
  sourceMilestoneName: string | null
  sourceItemKey: string | null
  sourceItemTitle: string | null
}

interface ChildBreakdownItem {
  id: number
  projectId: number
  milestoneId: number
  itemNumber: number
  itemKey: string
  tier: string
  type: string
  title: string
  description: string | null
  startDate: string | null
  dueDate: string | null
  status: string
  priority: string
  assigneeUid: string | null
  reporterUid: string | null
  estimatedHours: number | null
  parentId: number | null
  sortOrder: number
  deliverables: DeliverableItem[]
}

interface BreakdownContextData {
  item: {
    id: number
    projectId: number
    projectCode: string
    projectName: string
    milestoneId: number
    milestoneName: string
    milestoneStartDate: string | null
    milestoneEndDate: string | null
    pivrStage: PivrStage | null
    itemNumber: number
    itemKey: string
    tier: string
    type: WorkItemType
    title: string
    description: string | null
    startDate: string | null
    dueDate: string | null
    status: string
    priority: string
    severity: string | null
    assigneeUid: string | null
    reporterUid: string | null
    estimatedHours: number | null
    parentId: number | null
    approvalStatus: string
    reviewLevel: number
    required: boolean
    templateKey: string | null
    createdAt: string
    updatedAt: string
  }
  current: {
    documents: DocumentItem[]
    deliverables: DeliverableItem[]
  }
  children: ChildBreakdownItem[]
  previousArtifacts: {
    project: {
      id: number
      name: string
      documents: DocumentItem[]
    }
    milestones: Array<{
      id: number
      name: string
      pivrStage: string | null
      documents: DocumentItem[]
      workItems: Array<{
        id: number
        itemKey: string
        title: string
        documents: DocumentItem[]
      }>
    }>
    currentMilestoneCompleted: {
      milestoneId: number
      milestoneName: string
      pivrStage: string | null
      workItems: Array<{
        id: number
        itemKey: string
        title: string
        documents: DocumentItem[]
      }>
    }
  }
}

/** 任务卡本地状态 */
interface TaskFormItem {
  localKey: string
  existingChildId: number | null
  childTitle: string
  childStatus: string
  assigneeUid: string
  description: string
  startDate: string
  dueDate: string
  estimatedHours: string
  deliverables: TaskDeliverableForm[]
}

interface TaskDeliverableForm {
  localKey: string
  /** 引用的目标成果 id（null 表示任务自有成果） */
  sourceDeliverableId: number | null
  /** 已有数据库 id（用于复用） */
  id: number | null
  name: string
  description: string
  acceptanceCriteria: string
  deliverableType: string
}

interface AppendTaskForm {
  localKey: string
  existingChildId: number | null
  title: string
  assigneeUid: string
  description: string
  startDate: string
  dueDate: string
  estimatedHours: string
  deliverables: AppendDeliverableForm[]
}

interface AppendDeliverableForm {
  localKey: string
  name: string
  description: string
  acceptanceCriteria: string
  deliverableType: string
}

const deliverableStatusLabel: Record<string, string> = {
  pending: '待准备',
  submitted: '已提交',
  approved: '已通过',
  rejected: '已驳回'
}

const deliverableStatusColor: Record<string, string> = {
  pending: 'neutral',
  submitted: 'info',
  approved: 'success',
  rejected: 'error'
}

const pivrStageLabel: Record<string, string> = {
  P: '规划(P)',
  I: '实施(I)',
  V: '验证(V)',
  R: '复盘(R)'
}

const pivrStageColor: Record<string, string> = {
  P: 'info',
  I: 'primary',
  V: 'warning',
  R: 'success'
}

const route = useRoute()
const toast = useToast()
const { users: accountUsers } = useAccountUsers()
const { isApprovalMode } = useApprovalMode()
const projectStore = useProjectStore()
const { isWorkItemEditable } = storeToRefs(projectStore)
const { user: currentUserUid } = useAuth()

const projectId = computed(() => Number(route.params.id))
const workItemId = computed(() => Number(route.params.workItemId))

const context = ref<BreakdownContextData | null>(null)
const loading = ref(false)
const saving = ref(false)

const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const user of accountUsers.value) {
    if (user.realName?.trim()) {
      map.set(user.uid, user.realName.trim())
    }
  }
  return map
})

function getUserName(uid: string | null | undefined) {
  if (!uid) return '未指派'
  return userNameMap.value.get(uid) || uid
}

function formatDate(v: string | null | undefined) {
  if (!v) return '-'
  return v.slice(0, 10)
}

const memberOptions = computed(() => {
  const members = (projectStore.currentProject?.members || []).filter(m => m.status !== 'suspended')
  return members.map((member) => {
    const name = member.realName?.trim() || userNameMap.value.get(member.uid) || member.uid
    return {
      label: name,
      displayLabel: name,
      value: member.uid
    }
  })
})

// 当前已选中的成员 uid 列表
const selectedAssigneeUids = ref<string[]>([])

// 任务卡列表（与 selectedAssigneeUids 一一对应，顺序一致）
const tasks = ref<TaskFormItem[]>([])
// 追加任务草稿（仅保存 planning 态）
const appendDrafts = ref<AppendTaskForm[]>([])
const savingAppend = ref(false)
const showAppendTaskModal = ref(false)
const appendModalDraft = ref<AppendTaskForm | null>(null)

// 预览弹窗
const showDocPreview = ref(false)
const previewDocTitle = ref('')
const previewDocRef = ref<import('~/composables/useAimsDocumentPicker').DocumentRef | null>(null)

const prevExpanded = ref<Set<string>>(new Set())
function togglePrevNode(key: string) {
  if (prevExpanded.value.has(key)) {
    prevExpanded.value.delete(key)
  } else {
    prevExpanded.value.add(key)
  }
}

function openPreview(doc: DocumentItem) {
  const isRepoDoc = doc.documentSource === 'repo' || (!!doc.repoProjectCode && !!doc.repoFilePath)
  if (isRepoDoc) {
    if (!doc.repoProjectCode || !doc.repoFilePath) return
    previewDocRef.value = {
      source: 'repo',
      title: doc.title || '文档预览',
      repoProjectCode: doc.repoProjectCode,
      repoFilePath: doc.repoFilePath,
      repoCommitId: doc.repoCommitId || null
    }
  } else {
    const codocsUuid = doc.codocsUuid || doc.uuid
    if (!codocsUuid) return
    previewDocRef.value = {
      source: 'codocs',
      title: doc.title || '文档预览',
      codocsUuid
    }
  }
  previewDocTitle.value = doc.title
  showDocPreview.value = true
}

function getPivrStageLabel(stage: string | null | undefined) {
  if (!stage) return '未设置阶段'
  return pivrStageLabel[stage] || stage
}

function getPivrStageColor(stage: string | null | undefined) {
  if (!stage) return 'neutral'
  return pivrStageColor[stage] || 'neutral'
}

function canPreviewDeliverable(d: DeliverableItem) {
  const isRepoDoc = d.documentSource === 'repo' || (!!d.repoProjectCode && !!d.repoFilePath)
  if (isRepoDoc) {
    return !!d.repoProjectCode && !!d.repoFilePath
  }
  return !!d.documentUuid
}

function openDeliverablePreview(d: DeliverableItem) {
  const isRepoDoc = d.documentSource === 'repo' || (!!d.repoProjectCode && !!d.repoFilePath)
  if (isRepoDoc) {
    if (!d.repoProjectCode || !d.repoFilePath) return
    previewDocRef.value = {
      source: 'repo',
      title: d.documentTitle || d.name,
      repoProjectCode: d.repoProjectCode,
      repoFilePath: d.repoFilePath,
      repoCommitId: d.repoCommitId || null
    }
  } else {
    if (!d.documentUuid) return
    previewDocRef.value = {
      source: 'codocs',
      title: d.documentTitle || d.name,
      codocsUuid: d.documentUuid
    }
  }
  previewDocTitle.value = d.documentTitle || d.name
  showDocPreview.value = true
}

const currentPriorityBadge = computed(() => {
  if (!context.value) return null
  return priorityConfig[context.value.item.priority as keyof typeof priorityConfig] || null
})

/** 目标的成果要求（只读） */
const targetDeliverables = computed<DeliverableItem[]>(() => {
  return context.value?.current.deliverables || []
})

/** 是否允许编辑（所有子任务都在 planning——尚未确认分配；target 自身状态不影响） */
const canEdit = computed(() => {
  if (!context.value) return false
  if (!isWorkItemEditable.value) return false
  if (isApprovalMode.value) return false
  const children = context.value.children || []
  // 无子任务 → 空白状态可录入；有子任务则必须全部在 planning
  return children.every(c => c.status === 'planning')
})

const readonlyReason = computed(() => {
  if (!context.value) return ''
  const children = context.value.children || []
  if (children.length === 0) return ''
  const allTodo = children.every(c => c.status === 'todo')
  if (allTodo) {
    return '任务分配已确认并锁定。如需调整请在右侧流程面板点击"撤回任务分配"'
  }
  const anyExecuting = children.some(c => !['planning', 'todo'].includes(c.status))
  if (anyExecuting) {
    return '已有子任务进入执行阶段，无法再修改分配'
  }
  return ''
})

const EXECUTION_AND_AFTER_STATUSES = new Set(['in_progress', 'in_review', 'completed'])

const isExecutionOrLater = computed(() => {
  const status = context.value?.item.status
  return !!status && EXECUTION_AND_AFTER_STATUSES.has(status)
})

const showAssignmentCard = computed(() => {
  const item = context.value?.item
  if (!item) return false
  if (item.tier !== 'target' || item.type === 'requirement') return false
  return !isExecutionOrLater.value
})

const showExecutionTaskListCard = computed(() => {
  const item = context.value?.item
  if (!item) return false
  if (item.tier !== 'target' || item.type === 'requirement') return false
  return isExecutionOrLater.value
})

const taskListChildren = computed(() => {
  const children = [...(context.value?.children || [])]
  return children.sort((a, b) =>
    (a.sortOrder - b.sortOrder)
    || (a.itemNumber - b.itemNumber)
    || (a.id - b.id)
  )
})

const activeTaskListChildren = computed(() =>
  taskListChildren.value.filter(c => c.status !== 'planning')
)

const completedTaskCount = computed(() =>
  activeTaskListChildren.value.filter(c => c.status === 'completed').length
)

const taskCompletionPercent = computed(() => {
  const total = activeTaskListChildren.value.length
  if (total <= 0) return 0
  return Math.round((completedTaskCount.value / total) * 100)
})

const taskStatusCounts = computed(() => {
  const counts: Record<'planning' | 'todo' | 'in_progress' | 'in_review' | 'completed', number> = {
    planning: 0,
    todo: 0,
    in_progress: 0,
    in_review: 0,
    completed: 0
  }
  for (const child of taskListChildren.value) {
    if (child.status in counts) {
      counts[child.status as keyof typeof counts] += 1
    }
  }
  return counts
})

function getDeliverableCompletion(child: ChildBreakdownItem) {
  const total = child.deliverables?.length || 0
  if (total <= 0) return { completed: 0, total: 0 }
  const completed = child.deliverables.filter(d => String(d.status).toLowerCase() === 'completed').length
  return { completed, total }
}

/** 当前用户是否项目负责人（只有项目负责人可发起分配/撤回） */
const isProjectLeader = computed(() => {
  const leader = projectStore.currentProject?.leaderUid
  return !!leader && !!currentUserUid.value && leader === currentUserUid.value
})

/** 子任务数量（已保存到 DB） */
const childCount = computed(() => context.value?.children?.length || 0)

/** 所有已保存子任务是否都在 planning 态（用于 distribute 的校验） */
const allChildrenPlanning = computed(() => {
  const children = context.value?.children || []
  return children.length > 0 && children.every(c => c.status === 'planning')
})

/** 所有已保存子任务是否都在 todo 态（用于 revoke 的校验） */
const allChildrenTodo = computed(() => {
  const children = context.value?.children || []
  return children.length > 0 && children.every(c => c.status === 'todo')
})

/** 所有已保存子任务是否都在 completed 态（用于 complete 的校验） */
const allChildrenCompleted = computed(() => {
  const children = context.value?.children || []
  return children.length > 0 && children.every(c => c.status === 'completed')
})

/** 执行中目标是否允许编辑追加任务 */
const canEditAppend = computed(() => {
  const item = context.value?.item
  if (!item) return false
  return item.tier === 'target' && item.type !== 'requirement' && item.status === 'in_progress' && isProjectLeader.value
})

/** 草稿是否已具备发起 append 审批的基本条件 */
const hasPendingAppendDraft = computed(() =>
  appendDrafts.value.length > 0 && appendDrafts.value.every(t => t.assigneeUid)
)

/** 已生效子任务（非 planning） */
const activeChildren = computed(() =>
  (context.value?.children || []).filter(c => c.status !== 'planning')
)

/** 数据库中是否已有 planning 草稿（作为 append 审批前置） */
const hasDraftChildrenInDb = computed(() =>
  (context.value?.children || []).some(c => c.status === 'planning')
)

/** 是否存在待审批的新增任务（planning 态） */
const hasPendingAppendReview = computed(() => {
  const item = context.value?.item
  if (!item) return false
  return item.status === 'in_progress' && hasDraftChildrenInDb.value
})

/** 工时统计（已生效 + 追加草稿） */
const activeHoursTotal = computed(() => {
  let sum = 0
  for (const c of activeChildren.value) {
    const n = Number(c.estimatedHours || 0)
    if (Number.isFinite(n) && n > 0) sum += n
  }
  return Math.round(sum * 100) / 100
})

const appendHoursTotal = computed(() => {
  let sum = 0
  for (const t of appendDrafts.value) {
    const n = Number(t.estimatedHours)
    if (Number.isFinite(n) && n > 0) sum += n
  }
  return Math.round(sum * 100) / 100
})

const totalPlannedHours = computed(() =>
  Math.round((activeHoursTotal.value + appendHoursTotal.value) * 100) / 100
)

const appendHoursOverflow = computed(() => {
  const ctrl = context.value?.item.estimatedHours
  if (!ctrl) return false
  return totalPlannedHours.value - Number(ctrl) > 0.0001
})

function getAppendTaskIssues(task: AppendTaskForm, label: string) {
  const issues: string[] = []
  if (!task.title.trim()) issues.push(`${label} 缺少任务标题`)
  if (!task.assigneeUid) issues.push(`${label} 未选择负责人`)
  if (!task.startDate || !task.dueDate) {
    issues.push(`${label} 缺少起止日期`)
  } else if (new Date(task.startDate) > new Date(task.dueDate)) {
    issues.push(`${label} 日期范围不合法`)
  }
  if (!task.estimatedHours) {
    issues.push(`${label} 缺少计划工时`)
  } else {
    const h = Number(task.estimatedHours)
    if (!Number.isFinite(h) || h < 0) issues.push(`${label} 计划工时格式不合法`)
  }
  if (task.deliverables.length === 0) issues.push(`${label} 至少需要 1 条成果`)
  for (const [dIdx, d] of task.deliverables.entries()) {
    if (!d.name.trim()) issues.push(`${label} 的第 ${dIdx + 1} 条成果缺少名称`)
  }
  return issues
}

const appendCompletenessIssues = computed(() => {
  const issues: string[] = []
  if (!context.value) return issues
  if (appendDrafts.value.length === 0) {
    issues.push('尚未添加任何新增任务')
    return issues
  }
  for (const [idx, task] of appendDrafts.value.entries()) {
    const label = `新增任务 ${idx + 1}（${getUserName(task.assigneeUid)}）`
    issues.push(...getAppendTaskIssues(task, label))
  }
  return issues
})

function makeAppendDraft(uid: string): AppendTaskForm {
  return {
    localKey: crypto.randomUUID(),
    existingChildId: null,
    title: '',
    assigneeUid: uid,
    description: '',
    startDate: context.value?.item.startDate?.slice(0, 10) || '',
    dueDate: context.value?.item.dueDate?.slice(0, 10) || '',
    estimatedHours: '',
    deliverables: [{
      localKey: crypto.randomUUID(),
      name: '',
      description: '',
      acceptanceCriteria: '',
      deliverableType: 'document'
    }]
  }
}

function mapCompletionWorkflowStatusToWorkItemStatus(status: string): 'in_review' | 'completed' | 'in_progress' | null {
  if (status === 'running') return 'in_review'
  if (status === 'approved') return 'completed'
  if (status === 'rejected') return 'in_progress'
  return null
}

async function reconcileCompletionReviewStatus(item: BreakdownContextData['item']) {
  if (item.tier !== 'target' || !['in_progress', 'in_review'].includes(item.status)) return false

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
}

function openAppendTaskModal() {
  if (!canEditAppend.value) {
    toast.add({
      title: isProjectLeader.value ? '仅执行中目标可新增任务' : '仅项目负责人可新增任务',
      color: 'warning',
      icon: 'i-lucide-triangle-alert'
    })
    return
  }
  const defaultUid = memberOptions.value[0]?.value || ''
  appendModalDraft.value = makeAppendDraft(defaultUid)
  showAppendTaskModal.value = true
}

function addAppendDeliverable(task: AppendTaskForm) {
  task.deliverables.push({
    localKey: crypto.randomUUID(),
    name: '',
    description: '',
    acceptanceCriteria: '',
    deliverableType: 'document'
  })
}

function removeAppendDeliverable(task: AppendTaskForm, localKey: string) {
  task.deliverables = task.deliverables.filter(d => d.localKey !== localKey)
}

const appendModalIssues = computed(() => {
  const draft = appendModalDraft.value
  if (!draft) return []
  return getAppendTaskIssues(draft, '新增任务')
})

async function saveAppendDrafts() {
  const item = context.value?.item
  if (!item) return false
  if (appendCompletenessIssues.value.length > 0) {
    toast.add({
      title: '请完善新增任务信息',
      description: appendCompletenessIssues.value[0],
      color: 'warning',
      icon: 'i-lucide-triangle-alert'
    })
    return false
  }
  if (appendHoursOverflow.value && item.estimatedHours) {
    toast.add({
      title: '工时超出目标控制工时',
      description: `预计总工时 ${totalPlannedHours.value}h 已超出控制工时 ${item.estimatedHours}h`,
      color: 'warning',
      icon: 'i-lucide-triangle-alert'
    })
  }
  savingAppend.value = true
  try {
    await $fetch(`/api/v1/work-items/${workItemId.value}/append-tasks`, {
      method: 'POST',
      body: {
        subtasks: appendDrafts.value.map(task => ({
          assigneeUid: task.assigneeUid,
          title: task.title.trim() || item.title,
          description: task.description.trim() || null,
          startDate: task.startDate || null,
          dueDate: task.dueDate || null,
          estimatedHours: task.estimatedHours ? Number(task.estimatedHours) : null,
          deliverables: task.deliverables.map(d => ({
            name: d.name.trim(),
            description: d.description.trim() || null,
            acceptanceCriteria: d.acceptanceCriteria.trim() || null,
            deliverableType: d.deliverableType
          }))
        }))
      }
    })
    toast.add({ title: '新增任务草稿已保存，可在右侧流程面板发起评审', color: 'success', icon: 'i-lucide-check' })
    await loadContext()
    return true
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '保存失败'
    toast.add({ title: msg, color: 'error', icon: 'i-lucide-circle-x' })
    return false
  } finally {
    savingAppend.value = false
  }
}

async function submitAppendTaskFromModal() {
  const draft = appendModalDraft.value
  if (!draft) return
  if (appendModalIssues.value.length > 0) {
    toast.add({
      title: '请完善新增任务信息',
      description: appendModalIssues.value[0],
      color: 'warning',
      icon: 'i-lucide-triangle-alert'
    })
    return
  }
  const previousDrafts = [...appendDrafts.value]
  appendDrafts.value = [...appendDrafts.value, { ...draft, deliverables: draft.deliverables.map(d => ({ ...d })) }]
  const ok = await saveAppendDrafts()
  if (ok) {
    showAppendTaskModal.value = false
    appendModalDraft.value = null
  } else {
    appendDrafts.value = previousDrafts
  }
}

// ====== 页面流程声明：确认/撤回任务分配 ======
usePageWorkflow({
  appCode: 'aims',
  resourceCode: 'tasks',
  bizId: computed(() => String(workItemId.value)),
  bizTitle: computed(() => {
    if (!context.value) return ''
    return `${context.value.item.itemKey} ${context.value.item.title}`
  }),
  bizUrl: computed(() => {
    if (!context.value) return ''
    return resolveCurrentAppUrl(`/projects/${context.value.item.projectId}/work-items/${context.value.item.id}/breakdown`)
  }),
  bizContext: computed(() => ({
    project_id: context.value?.item.projectId || projectId.value
  })),
  actions: computed(() => {
    const item = context.value?.item
    // 需求 target 不走这套流程
    if (!item || item.tier !== 'target' || item.type === 'requirement') return []

    const completeIssues = computed(() => {
      const issues: string[] = []
      if (!isProjectLeader.value) issues.push('只有项目负责人可发起完成评审')
      if (childCount.value === 0) issues.push('尚未分配任何任务')
      if (item.status === 'in_review') {
        issues.push('目标已提交完成评审，等待审批结果')
      } else if (item.status === 'completed') {
        issues.push('目标已完成，不允许重复提交')
      } else if (item.status === 'in_progress' && !allChildrenCompleted.value) {
        const pendingCount = (context.value?.children || []).filter(c => c.status !== 'completed').length
        issues.push(`仍有 ${pendingCount} 个任务未完成`)
      }
      return issues
    })

    const appendIssues = computed(() => {
      const issues: string[] = []
      if (!isProjectLeader.value) issues.push('仅项目负责人可发起新增任务评审')
      if (!hasPendingAppendDraft.value) issues.push('请先录入并保存新增任务草稿')
      if (!hasDraftChildrenInDb.value) issues.push('请先保存新增任务草稿')
      issues.push(...appendCompletenessIssues.value)
      return issues
    })

    // 执行中/确认中/已完成阶段：展示完成评审流程；仅存在未审批新增任务时展示新增任务评审
    if (['in_progress', 'in_review', 'completed'].includes(item.status)) {
      const result = []
      if (hasPendingAppendReview.value) {
        result.push({
          actionCode: 'append',
          actionName: '新增任务评审',
          canSubmit: computed(() => appendIssues.value.length === 0),
          completenessIssues: appendIssues,
          async onApproved() {
            try {
              const res = await $fetch<{ code: number, data: { mattersUpdated: number } }>(
                `/api/v1/work-items/${workItemId.value}/confirm-append`,
                { method: 'POST' }
              )
              if (res.code === 0) {
                toast.add({ title: `已生效 ${res.data.mattersUpdated} 个新增任务`, color: 'success' })
              }
            } catch (err: unknown) {
              const msg = (err as { data?: { message?: string } })?.data?.message
                || (err as { message?: string })?.message
                || '确认新增任务失败'
              toast.add({ title: msg, color: 'error', duration: 6000 })
            } finally {
              await loadContext()
            }
          },
          async onRejected() {
            try {
              await $fetch(`/api/v1/work-items/${workItemId.value}/reject-append`, { method: 'POST' })
              toast.add({ title: '新增任务申请已驳回，草稿已清理', color: 'neutral' })
            } finally {
              await loadContext()
            }
          }
        })
      }

      result.push({
        actionCode: 'complete',
        actionName: '确认完成评审',
        canSubmit: computed(() => item.status === 'in_progress' && completeIssues.value.length === 0),
        completenessIssues: completeIssues,
        async onSubmitted() {
          await $fetch(`/api/v1/work-items/${workItemId.value}`, {
            method: 'PUT',
            body: { status: 'in_review' }
          })
          await loadContext()
        },
        async onApproved() {
          await $fetch(`/api/v1/work-items/${workItemId.value}`, {
            method: 'PUT',
            body: { status: 'completed' }
          })
          await loadContext()
        },
        async onRejected() {
          await $fetch(`/api/v1/work-items/${workItemId.value}`, {
            method: 'PUT',
            body: { status: 'in_progress' }
          })
          await loadContext()
        }
      })

      return result
    }

    const distributeIssues = computed(() => {
      const issues: string[] = []
      if (!isProjectLeader.value) issues.push('只有项目负责人可发起确认分配')
      if (childCount.value === 0) issues.push('尚未分配任何任务')
      if (childCount.value > 0 && !allChildrenPlanning.value) issues.push('存在非规划态的子任务')
      return issues
    })

    const revokeIssues = computed(() => {
      const issues: string[] = []
      if (!isProjectLeader.value) issues.push('只有项目负责人可发起撤回分配')
      if (!allChildrenTodo.value) issues.push('存在非待办态的子任务，无法撤回（严格模式）')
      return issues
    })

    if (childCount.value > 0 && allChildrenPlanning.value) {
      return [{
        actionCode: 'distribute',
        actionName: '确认任务分配',
        canSubmit: computed(() => distributeIssues.value.length === 0),
        completenessIssues: distributeIssues,
        async onApproved() {
          try {
            const res = await $fetch<{ code: number, data: { targetStatus: string, mattersUpdated: number } }>(
              `/api/v1/work-items/${workItemId.value}/confirm-distribute`,
              { method: 'POST' }
            )
            if (res.code === 0) {
              toast.add({ title: `已确认分配：${res.data.mattersUpdated} 个任务进入待办`, color: 'success' })
            }
          } catch (err: unknown) {
            const msg = (err as { data?: { message?: string } })?.data?.message
              || (err as { message?: string })?.message
              || '确认分配失败'
            toast.add({ title: msg, color: 'error', duration: 6000 })
            console.error('[confirm-distribute] failed:', err)
          } finally {
            await loadContext()
          }
        }
      }]
    }
    if (childCount.value > 0 && allChildrenTodo.value) {
      return [{
        actionCode: 'revoke',
        actionName: '撤回任务分配',
        canSubmit: computed(() => revokeIssues.value.length === 0),
        completenessIssues: revokeIssues,
        async onApproved() {
          try {
            const res = await $fetch<{ code: number, data: { targetStatus: string, mattersUpdated: number } }>(
              `/api/v1/work-items/${workItemId.value}/revoke-distribute`,
              { method: 'POST' }
            )
            if (res.code === 0) {
              toast.add({ title: `已撤回分配：${res.data.mattersUpdated} 个任务回退到规划中`, color: 'success' })
            }
          } catch (err: unknown) {
            const msg = (err as { data?: { message?: string } })?.data?.message
              || (err as { message?: string })?.message
              || '撤回分配失败'
            toast.add({ title: msg, color: 'error', duration: 6000 })
            console.error('[revoke-distribute] failed:', err)
          } finally {
            await loadContext()
          }
        }
      }]
    }
    return []
  })
})

/**
 * 根据成员 uid 查找已有的 child matter（可选，用来保留已有数据）
 */
function findExistingChildByAssignee(uid: string): ChildBreakdownItem | null {
  if (!context.value) return null
  return context.value.children.find(c => c.assigneeUid === uid) || null
}

/**
 * 构造一张任务卡默认数据
 * - 单成员：自动引用所有目标成果（不可取消）
 * - 多成员：默认空，自行勾选
 */
function buildTaskForm(uid: string, isSingle: boolean): TaskFormItem {
  const existing = findExistingChildByAssignee(uid)
  const startDate = existing?.startDate || context.value?.item.startDate || ''
  const dueDate = existing?.dueDate || context.value?.item.dueDate || ''

  // 优先使用已有的成果配置
  const existingDeliverables: TaskDeliverableForm[] = (existing?.deliverables || []).map(d => ({
    localKey: crypto.randomUUID(),
    sourceDeliverableId: d.sourceDeliverableId ?? null,
    id: d.id,
    name: d.name,
    description: d.description || '',
    acceptanceCriteria: d.acceptanceCriteria || '',
    deliverableType: d.deliverableType
  }))

  let deliverables: TaskDeliverableForm[]
  if (existingDeliverables.length > 0) {
    deliverables = existingDeliverables
  } else if (isSingle) {
    // 单成员：全选所有目标成果
    deliverables = targetDeliverables.value.map(d => ({
      localKey: crypto.randomUUID(),
      sourceDeliverableId: d.id,
      id: null,
      name: d.name,
      description: d.description || '',
      acceptanceCriteria: d.acceptanceCriteria || '',
      deliverableType: d.deliverableType
    }))
  } else {
    deliverables = []
  }

  return {
    localKey: crypto.randomUUID(),
    existingChildId: existing?.id ?? null,
    childTitle: existing?.title || context.value?.item.title || '',
    childStatus: existing?.status || 'planning',
    assigneeUid: uid,
    description: existing?.description || '',
    startDate: startDate || '',
    dueDate: dueDate || '',
    estimatedHours: existing?.estimatedHours ? String(existing.estimatedHours) : '',
    deliverables
  }
}

/**
 * 把单成员任务卡的 deliverables 强制补齐为"所有目标成果 + 已有自定义成果"
 * 用于从多人 → 单人 或 初次选中单人 的场景
 */
function ensureSingleMemberCoverage(task: TaskFormItem) {
  const customDeliverables = task.deliverables.filter(d => !d.sourceDeliverableId)
  const inherited = targetDeliverables.value.map(d => ({
    localKey: crypto.randomUUID(),
    sourceDeliverableId: d.id,
    id: null,
    name: d.name,
    description: d.description || '',
    acceptanceCriteria: d.acceptanceCriteria || '',
    deliverableType: d.deliverableType
  }))
  task.deliverables = [...inherited, ...customDeliverables]
}

/**
 * 成员选择变化时，重建任务卡数组
 * - 保留已存在的卡片（按 uid 匹配）
 * - 新增成员用 buildTaskForm
 * - 单人模式下强制补齐目标成果引用
 */
function onSelectedAssigneesChange(newUids: string[]) {
  const prevByUid = new Map(tasks.value.map(t => [t.assigneeUid, t]))
  const isSingle = newUids.length === 1
  tasks.value = newUids.map((uid) => {
    const prev = prevByUid.get(uid)
    if (prev) {
      if (isSingle) ensureSingleMemberCoverage(prev)
      return prev
    }
    return buildTaskForm(uid, isSingle)
  })
}

watch(selectedAssigneeUids, (val) => {
  onSelectedAssigneesChange([...val])
})

// 选中成员集合
const selectedAssigneeSet = computed(() => new Set(selectedAssigneeUids.value))

function toggleMember(uid: string) {
  const idx = selectedAssigneeUids.value.indexOf(uid)
  if (idx === -1) {
    selectedAssigneeUids.value = [...selectedAssigneeUids.value, uid]
  } else {
    const next = [...selectedAssigneeUids.value]
    next.splice(idx, 1)
    selectedAssigneeUids.value = next
  }
}

/**
 * 切换某条目标成果的勾选（用于多成员模式下手动勾选）
 * - 单成员模式：无效（强制全选）
 * - 多成员模式：允许勾选/取消
 * - code 类型：允许多人都勾选
 * - 其他类型：同一条目标成果只能被 1 个任务勾选
 */
function isTargetDeliverableChecked(task: TaskFormItem, sourceId: number): boolean {
  return task.deliverables.some(d => d.sourceDeliverableId === sourceId)
}

function canCheckTargetDeliverable(task: TaskFormItem, source: DeliverableItem): boolean {
  if (selectedAssigneeUids.value.length <= 1) return false // 单成员模式下不可取消
  if (MULTI_ASSIGN_DELIVERABLE_TYPES.has(source.deliverableType)) return true
  // 非 code 类型：检查是否已被其他任务勾选
  const takenByOther = tasks.value.some(
    t => t.localKey !== task.localKey && t.deliverables.some(d => d.sourceDeliverableId === source.id)
  )
  return !takenByOther
}

function toggleTargetDeliverable(task: TaskFormItem, source: DeliverableItem) {
  const idx = task.deliverables.findIndex(d => d.sourceDeliverableId === source.id)
  if (idx !== -1) {
    if (selectedAssigneeUids.value.length <= 1) return // 单成员强制保留
    // 用新数组替换触发响应式更新（v-for 和其他 task 的 canCheckTargetDeliverable 都能重新计算）
    task.deliverables = task.deliverables.filter((_, i) => i !== idx)
    // 触发 tasks 数组本身的响应（让其他 task 的模板重算 canCheck）
    tasks.value = [...tasks.value]
    return
  }
  if (!canCheckTargetDeliverable(task, source)) {
    toast.add({
      title: '无法勾选',
      description: `「${source.name}」已被其他成员认领（非代码类成果只能分配给一人）`,
      color: 'warning',
      icon: 'i-lucide-triangle-alert'
    })
    return
  }
  task.deliverables = [...task.deliverables, {
    localKey: crypto.randomUUID(),
    sourceDeliverableId: source.id,
    id: null,
    name: source.name,
    description: source.description || '',
    acceptanceCriteria: source.acceptanceCriteria || '',
    deliverableType: source.deliverableType
  }]
  tasks.value = [...tasks.value]
}

// 记录"展开编辑"状态的自定义成果 localKey 集合
const expandedCustomDeliverables = ref<Set<string>>(new Set())

function toggleCustomDeliverableExpand(localKey: string) {
  const next = new Set(expandedCustomDeliverables.value)
  if (next.has(localKey)) {
    next.delete(localKey)
  } else {
    next.add(localKey)
  }
  expandedCustomDeliverables.value = next
}

function addCustomDeliverable(task: TaskFormItem) {
  const localKey = crypto.randomUUID()
  task.deliverables.push({
    localKey,
    sourceDeliverableId: null,
    id: null,
    name: '',
    description: '',
    acceptanceCriteria: '',
    deliverableType: 'document'
  })
  // 新增的默认展开，方便填写
  expandedCustomDeliverables.value = new Set([...expandedCustomDeliverables.value, localKey])
}

function removeCustomDeliverable(task: TaskFormItem, localKey: string) {
  const item = task.deliverables.find(d => d.localKey === localKey)
  if (!item) return
  // 引用了目标成果的不能单独删除（走 toggleTargetDeliverable）
  if (item.sourceDeliverableId) {
    toggleTargetDeliverable(task, {
      id: item.sourceDeliverableId,
      deliverableType: item.deliverableType,
      name: item.name
    } as DeliverableItem)
    return
  }
  task.deliverables = task.deliverables.filter(d => d.localKey !== localKey)
}

// 完整性检查
const completenessIssues = computed(() => {
  const issues: string[] = []
  if (!context.value) return issues
  if (tasks.value.length === 0) {
    issues.push('尚未选择任何成员')
    return issues
  }

  const controlHours = context.value.item.estimatedHours
  let taskHoursTotal = 0

  // 每个任务卡的校验
  for (const [idx, task] of tasks.value.entries()) {
    const name = getUserName(task.assigneeUid)
    if (!task.startDate || !task.dueDate) {
      issues.push(`${name} 缺少起止日期`)
    } else if (new Date(task.startDate) > new Date(task.dueDate)) {
      issues.push(`${name} 日期范围不合法`)
    }
    if (!task.estimatedHours) {
      issues.push(`${name} 缺少计划工时`)
    } else {
      const hours = Number(task.estimatedHours)
      if (!Number.isFinite(hours) || hours < 0) {
        issues.push(`${name} 计划工时格式不合法`)
      } else {
        taskHoursTotal += hours
        if (controlHours && hours > controlHours) {
          issues.push(`${name} 计划工时 ${hours}h 超出目标控制工时 ${controlHours}h`)
        }
      }
    }
    if (task.deliverables.length === 0) {
      issues.push(`${name} 至少需要 1 条成果`)
    }
    for (const [dIdx, d] of task.deliverables.entries()) {
      if (!d.name.trim()) {
        issues.push(`${name} 的第 ${dIdx + 1} 条成果缺少名称`)
      }
    }
    void idx
  }

  // 所有任务计划工时之和不能超控制工时
  if (controlHours && taskHoursTotal - controlHours > 0.0001) {
    issues.push(`所有任务计划工时之和 ${Math.round(taskHoursTotal * 100) / 100}h 超出目标控制工时 ${controlHours}h`)
  }

  // 目标成果覆盖校验
  const covered = new Set<number>()
  for (const task of tasks.value) {
    for (const d of task.deliverables) {
      if (d.sourceDeliverableId) covered.add(d.sourceDeliverableId)
    }
  }
  const uncovered = targetDeliverables.value.filter(t => !covered.has(t.id))
  if (uncovered.length > 0) {
    issues.push(`目标成果未完全覆盖：${uncovered.map(t => t.name).join('、')}`)
  }

  return issues
})

/** 已分配工时合计（用于 UI 进度提示） */
const tasksHoursTotal = computed(() => {
  let sum = 0
  for (const t of tasks.value) {
    const n = Number(t.estimatedHours)
    if (Number.isFinite(n) && n > 0) sum += n
  }
  return Math.round(sum * 100) / 100
})

const hoursOverflow = computed(() => {
  const ctrl = context.value?.item.estimatedHours
  if (!ctrl) return false
  return tasksHoursTotal.value - ctrl > 0.0001
})

async function loadContext() {
  loading.value = true
  try {
    const [projectRes, ctxRes] = await Promise.all([
      projectStore.fetchProject(projectId.value),
      $fetch<{ code: number, data: BreakdownContextData }>(`/api/v1/work-items/${workItemId.value}/breakdown-context`)
    ])
    void projectRes
    if (ctxRes.code === 0) {
      let nextContext = ctxRes.data

      const reconciled = await reconcileCompletionReviewStatus(nextContext.item)
      if (reconciled) {
        const refreshed = await $fetch<{ code: number, data: BreakdownContextData }>(
          `/api/v1/work-items/${workItemId.value}/breakdown-context`
        )
        if (refreshed.code === 0) {
          nextContext = refreshed.data
        }
      }

      context.value = nextContext
      // 根据 children 回填 selectedAssigneeUids 和 tasks
      const children = nextContext.children || []
      const uids = children.map(c => c.assigneeUid).filter(Boolean) as string[]
      selectedAssigneeUids.value = [...new Set(uids)]
      const isSingle = uids.length === 1
      tasks.value = uids.map(uid => buildTaskForm(uid, isSingle))

      // 回填追加任务草稿（planning 态）
      const planningChildren = children.filter(c => c.status === 'planning')
      appendDrafts.value = planningChildren.map((child) => {
        const customDeliverables = (child.deliverables || [])
          .filter(d => !d.sourceDeliverableId)
          .map(d => ({
            localKey: crypto.randomUUID(),
            name: d.name,
            description: d.description || '',
            acceptanceCriteria: d.acceptanceCriteria || '',
            deliverableType: d.deliverableType
          }))

        return {
          localKey: crypto.randomUUID(),
          existingChildId: child.id,
          title: child.title || '',
          assigneeUid: child.assigneeUid || '',
          description: child.description || '',
          startDate: (child.startDate || '').slice(0, 10),
          dueDate: (child.dueDate || '').slice(0, 10),
          estimatedHours: child.estimatedHours ? String(child.estimatedHours) : '',
          deliverables: customDeliverables.length > 0
            ? customDeliverables
            : [{
                localKey: crypto.randomUUID(),
                name: '',
                description: '',
                acceptanceCriteria: '',
                deliverableType: 'document'
              }]
        }
      })
      appendModalDraft.value = null
      showAppendTaskModal.value = false
    }
  } finally {
    loading.value = false
  }
}

async function saveBreakdown() {
  if (!context.value) return
  const issues = completenessIssues.value
  if (issues.length > 0) {
    toast.add({
      title: '请完善任务分配信息',
      description: issues[0],
      color: 'warning',
      icon: 'i-lucide-triangle-alert'
    })
    return
  }
  saving.value = true
  try {
    await $fetch(`/api/v1/work-items/${workItemId.value}/breakdown`, {
      method: 'PUT',
      body: {
        subtasks: tasks.value.map(task => ({
          id: task.existingChildId,
          assigneeUid: task.assigneeUid,
          title: context.value!.item.title,
          description: task.description.trim() || null,
          startDate: task.startDate || null,
          dueDate: task.dueDate || null,
          estimatedHours: task.estimatedHours ? Number(task.estimatedHours) : null,
          deliverables: task.deliverables.map(d => ({
            id: d.id,
            name: d.name.trim(),
            description: d.description.trim() || null,
            acceptanceCriteria: d.acceptanceCriteria.trim() || null,
            deliverableType: d.deliverableType,
            sourceDeliverableId: d.sourceDeliverableId
          }))
        }))
      }
    })
    toast.add({ title: '任务分配已保存', color: 'success', icon: 'i-lucide-check' })
    await loadContext()
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '保存失败'
    toast.add({ title: msg, color: 'error', icon: 'i-lucide-circle-x' })
  } finally {
    saving.value = false
  }
}

const previousArtifactCount = computed(() => {
  if (!context.value) return 0
  const pa = context.value.previousArtifacts
  let count = pa.project.documents.length
  for (const ms of pa.milestones) {
    count += ms.documents.length
    for (const wi of ms.workItems) {
      count += wi.documents.length
    }
  }
  for (const wi of pa.currentMilestoneCompleted.workItems) {
    count += wi.documents.length
  }
  return count
})

onMounted(async () => {
  await loadContext()
})
</script>

<template>
  <Teleport to="#aims-layout-header-actions">
    <UButton
      icon="i-lucide-arrow-left"
      label="返回列表"
      color="neutral"
      variant="ghost"
      size="sm"
      @click="navigateTo(`/projects/${projectId}/work-items`)"
    />
  </Teleport>

  <UDashboardPanel
    id="work-item-breakdown"
    :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 overflow-y-auto p-0' }"
  >
    <template #body>
      <ProjectNavbar />
      <div class="px-0 pt-0 pb-12 sm:pb-14">
        <div v-if="loading || !context" class="flex items-center justify-center py-20">
          <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-muted" />
        </div>

        <div v-else class="mx-auto max-w-6xl px-4 pt-0 pb-6 space-y-6">
          <!-- 目标信息卡（只读） -->
          <UCard class="overflow-hidden border-primary/20 bg-linear-to-br from-primary/10 via-info/5 to-transparent shadow-sm">
            <template #header>
              <div class="flex flex-wrap items-center gap-3">
                <div class="flex items-center gap-2 min-w-0">
                  <UIcon
                    :name="typeConfig[context.item.type]?.icon || 'i-lucide-circle'"
                    :class="['size-5 shrink-0', typeConfig[context.item.type]?.color || 'text-muted']"
                  />
                  <h1 class="text-xl font-semibold truncate">
                    {{ context.item.title }}
                  </h1>
                </div>
                <div class="flex flex-wrap items-center gap-2 ml-auto">
                  <UBadge color="neutral" variant="subtle">
                    {{ context.item.itemKey }}
                  </UBadge>
                  <UBadge :color="(getStatusColor(context.item.status) as any)" variant="subtle">
                    {{ getStatusLabel(context.item.status) }}
                  </UBadge>
                  <UBadge
                    v-if="currentPriorityBadge"
                    :color="(currentPriorityBadge.color as any)"
                    variant="soft"
                  >
                    {{ currentPriorityBadge.label }}
                  </UBadge>
                  <UBadge color="neutral" variant="subtle">
                    评审：{{ reviewLevelLabel[context.item.reviewLevel] || '一般' }}
                  </UBadge>
                </div>
              </div>
            </template>

            <div class="grid gap-3 md:grid-cols-4">
              <div class="rounded-lg border border-default/70 bg-default/60 px-3 py-2">
                <div class="text-xs uppercase tracking-wide text-dimmed">
                  里程碑
                </div>
                <div class="mt-1 text-sm font-medium truncate">
                  {{ context.item.milestoneName }}
                </div>
              </div>
              <div class="rounded-lg border border-default/70 bg-default/60 px-3 py-2">
                <div class="text-xs uppercase tracking-wide text-dimmed">
                  控制工时
                </div>
                <div class="mt-1 text-sm font-medium">
                  {{ context.item.estimatedHours || '-' }}h
                </div>
              </div>
              <div class="rounded-lg border border-default/70 bg-default/60 px-3 py-2">
                <div class="text-xs uppercase tracking-wide text-dimmed">
                  开始日期
                </div>
                <div class="mt-1 text-sm font-medium">
                  {{ formatDate(context.item.startDate) }}
                </div>
              </div>
              <div class="rounded-lg border border-default/70 bg-default/60 px-3 py-2">
                <div class="text-xs uppercase tracking-wide text-dimmed">
                  结束日期
                </div>
                <div class="mt-1 text-sm font-medium">
                  {{ formatDate(context.item.dueDate) }}
                </div>
              </div>
            </div>

            <MarkdownContent
              v-if="context.item.description"
              :markdown="context.item.description"
              class="mt-4 rounded-md bg-elevated/50 p-3 text-sm"
            />
          </UCard>

          <!-- 目标成果要求（只读） -->
          <UCard class="shadow-sm">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-clipboard-check" class="size-5 text-primary" />
                <span class="font-semibold">目标成果要求</span>
                <span class="text-sm text-muted">{{ targetDeliverables.length }} 条</span>
              </div>
            </template>

            <div v-if="targetDeliverables.length === 0" class="text-center text-sm text-muted py-4">
              暂未配置成果要求
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="d in targetDeliverables"
                :key="d.id"
                class="rounded-md border border-default p-3"
              >
                <div class="flex items-center gap-2">
                  <UIcon
                    :name="deliverableTypeIcon[d.deliverableType] || 'i-lucide-pocket-knife'"
                    class="size-4 text-muted shrink-0"
                  />
                  <span class="font-medium text-sm truncate">{{ d.name }}</span>
                  <UBadge variant="subtle" color="neutral" size="xs">
                    {{ deliverableTypeLabel[d.deliverableType] || d.deliverableType }}
                  </UBadge>
                </div>
                <div v-if="d.description" class="ml-6 mt-1 text-xs text-muted whitespace-pre-wrap">
                  {{ d.description }}
                </div>
                <div v-if="d.acceptanceCriteria" class="ml-6 mt-1 text-xs text-muted">
                  验收标准：{{ d.acceptanceCriteria }}
                </div>
              </div>
            </div>
          </UCard>

          <!-- 只读提示 -->
          <UAlert
            v-if="showAssignmentCard && !canEdit && readonlyReason"
            color="warning"
            variant="soft"
            :title="readonlyReason"
          />

          <!-- 任务分配区 -->
          <UCard v-if="showAssignmentCard" class="shadow-sm">
            <template #header>
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-users" class="size-5 text-warning" />
                  <span class="font-semibold">任务分配</span>
                  <span class="text-sm text-muted">{{ tasks.length }} 人</span>
                </div>
              </div>
            </template>

            <fieldset :disabled="!canEdit" class="space-y-4 contents">
              <!-- 成员多选（复选按钮） -->
              <UFormField label="任务负责人" required>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="member in memberOptions"
                    :key="member.value"
                    type="button"
                    class="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors"
                    :class="[
                      selectedAssigneeSet.has(member.value)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-default hover:bg-elevated'
                    ]"
                    :disabled="!canEdit"
                    @click="toggleMember(member.value)"
                  >
                    <UIcon
                      :name="selectedAssigneeSet.has(member.value) ? 'i-lucide-check-square' : 'i-lucide-square'"
                      class="size-4 shrink-0"
                    />
                    <span class="truncate">{{ member.label }}</span>
                  </button>
                  <div v-if="memberOptions.length === 0" class="text-sm text-muted px-2 py-1.5">
                    当前项目没有可选成员
                  </div>
                </div>
              </UFormField>

              <!-- 空态提示 -->
              <div
                v-if="tasks.length === 0"
                class="rounded-lg border border-dashed border-default p-6 text-center text-sm text-muted"
              >
                尚未进行任务分配，请选择任务负责人
              </div>

              <!-- 工时合计提示 -->
              <div
                v-if="tasks.length > 0 && context?.item.estimatedHours"
                class="flex items-center justify-between rounded-md border border-default bg-elevated/40 px-3 py-2 text-xs"
                :class="hoursOverflow ? 'border-error/50 text-error' : 'text-muted'"
              >
                <span>计划工时合计</span>
                <span class="font-medium">
                  {{ tasksHoursTotal }}h / {{ context.item.estimatedHours }}h
                  <span v-if="hoursOverflow" class="ml-2">超出上限</span>
                </span>
              </div>

              <!-- 任务卡列表 -->
              <div v-if="tasks.length > 0" class="space-y-3">
                <div
                  v-for="task in tasks"
                  :key="task.localKey"
                  class="rounded-lg border border-default bg-elevated/20 p-4 space-y-4"
                >
                  <!-- 卡片头部：姓名 -->
                  <div class="flex flex-wrap items-center gap-2">
                    <UIcon name="i-lucide-user-round" class="size-5 text-primary shrink-0" />
                    <span class="font-semibold">{{ getUserName(task.assigneeUid) }}</span>
                    <UBadge
                      v-if="task.existingChildId"
                      color="success"
                      variant="subtle"
                      size="xs"
                    >
                      已创建
                    </UBadge>
                    <div v-if="task.existingChildId" class="ml-auto flex items-center gap-2 min-w-0">
                      <span class="text-xs text-muted truncate max-w-48">
                        {{ task.childTitle }}
                      </span>
                      <UBadge :color="(getStatusColor(task.childStatus) as any)" variant="subtle" size="xs">
                        {{ getStatusLabel(task.childStatus) }}
                      </UBadge>
                    </div>
                  </div>

                  <!-- 基本字段 -->
                  <div class="grid gap-3 md:grid-cols-3">
                    <UFormField label="开始日期" required>
                      <UInput v-model="task.startDate" type="date" class="w-full" />
                    </UFormField>
                    <UFormField label="结束日期" required>
                      <UInput v-model="task.dueDate" type="date" class="w-full" />
                    </UFormField>
                    <UFormField label="计划工时" required :hint="context?.item.estimatedHours ? `≤ ${context.item.estimatedHours}h` : undefined">
                      <UInput
                        v-model="task.estimatedHours"
                        type="number"
                        min="0"
                        :max="context?.item.estimatedHours ?? undefined"
                        step="0.5"
                        placeholder="如 8"
                        class="w-full"
                      />
                    </UFormField>
                  </div>

                  <UFormField label="具体描述">
                    <UTextarea
                      v-model="task.description"
                      :rows="2"
                      placeholder="任务说明（选填，用于特殊注意事项）"
                      class="w-full"
                    />
                  </UFormField>

                  <!-- 成果要求 -->
                  <div class="rounded-md border border-default p-3 space-y-3">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <UIcon name="i-lucide-clipboard-list" class="size-4 text-primary" />
                        <span class="text-sm font-medium">成果要求</span>
                        <span class="text-xs text-muted">{{ task.deliverables.length }} 条</span>
                      </div>
                      <UButton
                        size="xs"
                        variant="ghost"
                        color="primary"
                        icon="i-lucide-plus"
                        label="追加自定义成果"
                        @click="addCustomDeliverable(task)"
                      />
                    </div>

                    <!-- 目标成果勾选区（单人：全选不可取消；多人：自由勾选） -->
                    <div
                      v-if="targetDeliverables.length > 0"
                      class="space-y-1.5"
                    >
                      <div class="text-xs text-dimmed">
                        <template v-if="selectedAssigneeUids.length === 1">
                          已自动继承目标全部 {{ targetDeliverables.length }} 条成果要求（不可取消），可追加自定义成果
                        </template>
                        <template v-else>
                          从目标成果中选择（可多人共选的已标注「可多人」）：
                        </template>
                      </div>
                      <div
                        v-for="source in targetDeliverables"
                        :key="`${task.localKey}-${source.id}`"
                        class="flex items-center gap-2 rounded-md border border-default px-2 py-1.5 hover:bg-elevated/50"
                        :class="[
                          isTargetDeliverableChecked(task, source.id) ? 'bg-primary/5 border-primary/30' : '',
                          selectedAssigneeUids.length === 1
                            ? 'cursor-not-allowed'
                            : (!isTargetDeliverableChecked(task, source.id) && !canCheckTargetDeliverable(task, source) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer')
                        ]"
                        @click="selectedAssigneeUids.length > 1 && toggleTargetDeliverable(task, source)"
                      >
                        <UCheckbox
                          :model-value="isTargetDeliverableChecked(task, source.id)"
                          :disabled="selectedAssigneeUids.length === 1 || (!isTargetDeliverableChecked(task, source.id) && !canCheckTargetDeliverable(task, source))"
                          @update:model-value="selectedAssigneeUids.length > 1 && toggleTargetDeliverable(task, source)"
                          @click.stop
                        />
                        <UIcon
                          :name="deliverableTypeIcon[source.deliverableType] || 'i-lucide-pocket-knife'"
                          class="size-4 text-muted shrink-0"
                        />
                        <span class="text-sm truncate flex-1">{{ source.name }}</span>
                        <UBadge variant="subtle" color="neutral" size="xs">
                          {{ deliverableTypeLabel[source.deliverableType] || source.deliverableType }}
                        </UBadge>
                        <UBadge
                          v-if="MULTI_ASSIGN_DELIVERABLE_TYPES.has(source.deliverableType)"
                          color="info"
                          variant="subtle"
                          size="xs"
                        >
                          可多人
                        </UBadge>
                      </div>
                    </div>

                    <!-- 自定义成果编辑区（默认折叠展示，点击展开编辑） -->
                    <div
                      v-for="d in task.deliverables.filter(x => !x.sourceDeliverableId)"
                      :key="d.localKey"
                      class="rounded-md border border-info/30 bg-info/5"
                    >
                      <!-- 折叠态（摘要行） -->
                      <div
                        v-if="!expandedCustomDeliverables.has(d.localKey)"
                        class="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-info/10"
                        @click="toggleCustomDeliverableExpand(d.localKey)"
                      >
                        <UIcon name="i-lucide-chevron-right" class="size-4 text-muted shrink-0" />
                        <UIcon
                          :name="deliverableTypeIcon[d.deliverableType] || 'i-lucide-pocket-knife'"
                          class="size-4 text-muted shrink-0"
                        />
                        <span class="text-sm truncate flex-1">
                          {{ d.name || '（未命名自定义成果）' }}
                        </span>
                        <UBadge variant="subtle" color="info" size="xs">
                          自定义
                        </UBadge>
                        <UBadge variant="subtle" color="neutral" size="xs">
                          {{ deliverableTypeLabel[d.deliverableType] || d.deliverableType }}
                        </UBadge>
                      </div>

                      <!-- 展开态（编辑） -->
                      <div v-else class="p-2 space-y-2">
                        <div
                          class="flex items-center gap-2 cursor-pointer"
                          @click="toggleCustomDeliverableExpand(d.localKey)"
                        >
                          <UIcon name="i-lucide-chevron-down" class="size-4 text-muted shrink-0" />
                          <span class="text-xs text-dimmed">点击收起</span>
                        </div>
                        <div class="grid gap-2 md:grid-cols-8">
                          <USelect
                            v-model="d.deliverableType"
                            :items="deliverableTypeOptions"
                            value-key="value"
                            label-key="label"
                            class="md:col-span-2"
                          />
                          <UInput
                            v-model="d.name"
                            placeholder="自定义成果名称"
                            class="md:col-span-6"
                          />
                        </div>
                        <UInput
                          v-model="d.acceptanceCriteria"
                          placeholder="验收标准（选填）"
                          class="w-full"
                        />
                        <div class="flex justify-end">
                          <UButton
                            size="xs"
                            variant="ghost"
                            color="error"
                            icon="i-lucide-trash-2"
                            label="移除"
                            @click="removeCustomDeliverable(task, d.localKey)"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 完整性提示 -->
              <div v-if="completenessIssues.length > 0" class="rounded-lg bg-warning/10 px-3 py-2 space-y-1">
                <div class="text-xs font-medium text-warning">
                  完整性检查
                </div>
                <div
                  v-for="issue in completenessIssues"
                  :key="issue"
                  class="text-xs text-warning"
                >
                  · {{ issue }}
                </div>
              </div>

              <!-- 保存按钮 -->
              <div class="flex justify-end">
                <UButton
                  icon="i-lucide-save"
                  label="保存任务分配"
                  color="primary"
                  :loading="saving"
                  :disabled="tasks.length === 0 || completenessIssues.length > 0"
                  @click="saveBreakdown"
                />
              </div>
            </fieldset>
          </UCard>

          <!-- 执行中及后续阶段：任务列表 -->
          <UCard v-if="showExecutionTaskListCard" class="shadow-sm">
            <template #header>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-list-checks" class="size-5 text-primary" />
                  <span class="font-semibold">任务列表</span>
                  <span class="text-sm text-muted">{{ taskListChildren.length }} 项</span>
                </div>
                <div class="flex items-center gap-2">
                  <UBadge
                    variant="subtle"
                    :color="activeTaskListChildren.length > 0 && completedTaskCount === activeTaskListChildren.length ? 'success' : 'warning'"
                  >
                    已完成 {{ completedTaskCount }}/{{ activeTaskListChildren.length }}（{{ taskCompletionPercent }}%）
                  </UBadge>
                  <UButton
                    v-if="context.item.status === 'in_progress'"
                    icon="i-lucide-plus"
                    label="新增任务"
                    color="primary"
                    variant="soft"
                    size="sm"
                    :disabled="!canEditAppend"
                    :title="canEditAppend ? '新增任务并发起评审' : (isProjectLeader ? '仅执行中目标可新增任务' : '仅项目负责人可新增任务')"
                    @click="openAppendTaskModal"
                  />
                </div>
              </div>
            </template>

            <div class="space-y-4">
              <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
                <div class="rounded-md border border-default bg-elevated/40 px-3 py-2 text-xs text-muted">
                  待办：{{ taskStatusCounts.todo }}
                </div>
                <div class="rounded-md border border-default bg-elevated/40 px-3 py-2 text-xs text-muted">
                  执行中：{{ taskStatusCounts.in_progress }}
                </div>
                <div class="rounded-md border border-default bg-elevated/40 px-3 py-2 text-xs text-muted">
                  确认中：{{ taskStatusCounts.in_review }}
                </div>
                <div class="rounded-md border border-default bg-elevated/40 px-3 py-2 text-xs text-muted">
                  已完成：{{ taskStatusCounts.completed }}
                </div>
              </div>

              <UAlert
                v-if="taskStatusCounts.planning > 0"
                color="warning"
                variant="soft"
                :title="`存在 ${taskStatusCounts.planning} 个新增任务草稿，待评审通过后生效`"
              />

              <div
                v-if="context?.item.estimatedHours && appendDrafts.length > 0"
                class="flex items-center justify-between rounded-md border border-default px-3 py-2 text-xs"
                :class="appendHoursOverflow ? 'border-warning/50 bg-warning/5 text-warning' : 'bg-elevated/40 text-muted'"
              >
                <span>计划总工时（已生效 + 新增草稿）</span>
                <span class="font-medium">
                  {{ totalPlannedHours }}h / {{ context.item.estimatedHours }}h
                  <span v-if="appendHoursOverflow" class="ml-2">已超出，仅提示</span>
                </span>
              </div>

              <div
                v-if="taskListChildren.length === 0"
                class="rounded-lg border border-dashed border-default p-6 text-center text-sm text-muted"
              >
                暂无任务
              </div>

              <div v-else class="space-y-3">
                <div
                  v-for="child in taskListChildren"
                  :key="child.id"
                  class="rounded-lg border border-default p-4 space-y-3"
                  :class="child.status === 'planning' ? 'bg-warning/5 border-warning/30' : 'bg-elevated/20'"
                >
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="min-w-0 flex-1">
                      <div class="truncate font-medium">
                        {{ child.itemKey }} {{ child.title }}
                      </div>
                    </div>
                    <span class="text-xs text-muted">{{ getUserName(child.assigneeUid) }}</span>
                    <UBadge :color="(getStatusColor(child.status) as any)" variant="subtle" size="xs">
                      {{ getStatusLabel(child.status) }}
                    </UBadge>
                    <UBadge
                      v-if="child.status === 'planning'"
                      color="warning"
                      variant="subtle"
                      size="xs"
                    >
                      待新增任务评审
                    </UBadge>
                  </div>

                  <div class="grid gap-2 text-xs text-muted md:grid-cols-2 xl:grid-cols-4">
                    <div>开始：{{ formatDate(child.startDate) }}</div>
                    <div>结束：{{ formatDate(child.dueDate) }}</div>
                    <div>计划工时：{{ child.estimatedHours ?? '-' }}h</div>
                    <div>
                      成果完成：
                      <template v-if="getDeliverableCompletion(child).total > 0">
                        {{ getDeliverableCompletion(child).completed }}/{{ getDeliverableCompletion(child).total }}
                      </template>
                      <template v-else>
                        -
                      </template>
                    </div>
                  </div>

                  <div v-if="child.description" class="rounded-md bg-elevated/50 p-2 text-xs text-muted whitespace-pre-wrap">
                    {{ child.description }}
                  </div>

                  <div class="space-y-2">
                    <div class="flex items-center gap-2">
                      <UIcon name="i-lucide-clipboard-list" class="size-4 text-primary" />
                      <span class="text-sm font-medium">工作成果</span>
                      <span class="text-xs text-muted">{{ child.deliverables.length }} 条</span>
                    </div>

                    <div
                      v-if="child.deliverables.length === 0"
                      class="rounded-md border border-dashed border-default p-2 text-xs text-muted"
                    >
                      暂无成果记录
                    </div>

                    <div v-else class="space-y-2">
                      <div
                        v-for="d in child.deliverables"
                        :key="d.id"
                        class="rounded-md border border-default bg-elevated/20 p-2 space-y-1.5"
                      >
                        <div class="flex flex-wrap items-center gap-2">
                          <UIcon
                            :name="deliverableTypeIcon[d.deliverableType] || 'i-lucide-pocket-knife'"
                            class="size-4 text-muted shrink-0"
                          />
                          <span class="text-sm font-medium truncate">{{ d.name }}</span>
                          <UBadge variant="subtle" color="neutral" size="xs">
                            {{ deliverableTypeLabel[d.deliverableType] || d.deliverableType }}
                          </UBadge>
                          <UBadge :color="(deliverableStatusColor[d.status] as any) || 'neutral'" variant="subtle" size="xs">
                            {{ deliverableStatusLabel[d.status] || d.status || '未知' }}
                          </UBadge>
                        </div>

                        <div v-if="d.acceptanceCriteria" class="text-xs text-muted">
                          验收标准：{{ d.acceptanceCriteria }}
                        </div>

                        <button
                          v-if="canPreviewDeliverable(d)"
                          type="button"
                          class="w-full flex items-center gap-2 rounded-md bg-elevated px-2 py-1.5 text-left text-xs hover:bg-elevated/80"
                          @click="openDeliverablePreview(d)"
                        >
                          <UIcon name="i-lucide-file-search" class="size-3.5 text-primary shrink-0" />
                          <span class="truncate">{{ d.documentTitle || d.repoFilePath || d.documentUuid || d.name }}</span>
                          <span class="ml-auto text-muted shrink-0">点击查看</span>
                        </button>
                        <div v-else-if="d.documentTitle || d.documentUuid" class="text-xs text-muted break-all">
                          提交文档：{{ d.documentTitle || d.documentUuid }}
                        </div>

                        <div v-if="d.evidenceUrl" class="text-xs text-muted break-all">
                          证据链接：{{ d.evidenceUrl }}
                        </div>
                        <div v-if="d.evidenceNote" class="text-xs text-muted whitespace-pre-wrap">
                          证据备注：{{ d.evidenceNote }}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <p v-if="hasPendingAppendReview" class="text-xs text-muted">
                存在新增任务草稿，请在右侧审批栏发起「新增任务评审」。
              </p>
            </div>
          </UCard>

          <!-- 前序阶段产物（保持原有树形结构） -->
          <UCard v-if="previousArtifactCount > 0" class="shadow-sm">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-folder-tree" class="size-5 text-info" />
                <span class="font-semibold">前序阶段产物</span>
                <span class="text-sm text-muted">{{ previousArtifactCount }} 份文档</span>
              </div>
            </template>

            <div class="space-y-1">
              <!-- 项目级文档 -->
              <div v-if="context.previousArtifacts.project.documents.length > 0">
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-2 py-1.5 rounded-md hover:bg-elevated text-left"
                  @click="togglePrevNode('project')"
                >
                  <UIcon
                    :name="prevExpanded.has('project') ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    class="size-4 text-muted shrink-0"
                  />
                  <UIcon name="i-lucide-folder" class="size-4 text-primary shrink-0" />
                  <span class="text-sm font-medium truncate">{{ context.previousArtifacts.project.name }}</span>
                  <UBadge
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    {{ context.previousArtifacts.project.documents.length }}
                  </UBadge>
                </button>
                <div v-if="prevExpanded.has('project')" class="pl-8 space-y-0.5 mt-1">
                  <button
                    v-for="doc in context.previousArtifacts.project.documents"
                    :key="`project-doc-${doc.id}`"
                    type="button"
                    class="flex w-full items-center gap-2 px-2 py-1.5 rounded-md hover:bg-elevated text-left"
                    @click="openPreview(doc)"
                  >
                    <UIcon name="i-lucide-file-text" class="size-4 text-info shrink-0" />
                    <span class="text-sm truncate flex-1">{{ doc.title }}</span>
                    <UIcon name="i-lucide-external-link" class="size-3.5 text-muted shrink-0" />
                  </button>
                </div>
              </div>

              <!-- 前序里程碑 -->
              <div
                v-for="ms in context.previousArtifacts.milestones"
                :key="`ms-${ms.id}`"
              >
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-2 py-1.5 rounded-md hover:bg-elevated text-left"
                  @click="togglePrevNode(`ms-${ms.id}`)"
                >
                  <UIcon
                    :name="prevExpanded.has(`ms-${ms.id}`) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    class="size-4 text-muted shrink-0"
                  />
                  <UIcon name="i-lucide-milestone" class="size-4 text-warning shrink-0" />
                  <span class="text-sm font-medium truncate flex-1">{{ ms.name }}</span>
                  <UBadge :color="(getPivrStageColor(ms.pivrStage) as any)" variant="subtle" size="xs">
                    {{ getPivrStageLabel(ms.pivrStage) }}
                  </UBadge>
                  <UBadge color="neutral" variant="subtle" size="xs">
                    {{ ms.documents.length + ms.workItems.reduce((a, wi) => a + wi.documents.length, 0) }}
                  </UBadge>
                </button>
                <div v-if="prevExpanded.has(`ms-${ms.id}`)" class="pl-6 space-y-0.5 mt-1">
                  <button
                    v-for="doc in ms.documents"
                    :key="`ms-doc-${doc.id}`"
                    type="button"
                    class="flex w-full items-center gap-2 px-2 py-1.5 rounded-md hover:bg-elevated text-left"
                    @click="openPreview(doc)"
                  >
                    <UIcon name="i-lucide-file-text" class="size-4 text-info shrink-0" />
                    <span class="text-sm truncate flex-1">{{ doc.title }}</span>
                    <UIcon name="i-lucide-external-link" class="size-3.5 text-muted shrink-0" />
                  </button>
                  <div v-for="wi in ms.workItems" :key="`ms-wi-${wi.id}`">
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 px-2 py-1.5 rounded-md hover:bg-elevated text-left select-none"
                      @click="togglePrevNode(`ms-wi-${wi.id}`)"
                    >
                      <UIcon
                        :name="prevExpanded.has(`ms-wi-${wi.id}`) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                        class="size-4 text-muted shrink-0"
                      />
                      <UIcon name="i-lucide-square-check" class="size-4 text-success shrink-0" />
                      <span class="text-sm truncate flex-1">{{ wi.itemKey }} {{ wi.title }}</span>
                      <UBadge color="neutral" variant="subtle" size="xs">
                        {{ wi.documents.length }}
                      </UBadge>
                    </button>
                    <div v-if="prevExpanded.has(`ms-wi-${wi.id}`)" class="pl-6 space-y-0.5 mt-1">
                      <button
                        v-for="doc in wi.documents"
                        :key="`ms-wi-doc-${doc.id}`"
                        type="button"
                        class="flex w-full items-center gap-2 px-2 py-1.5 rounded-md hover:bg-elevated text-left"
                        @click="openPreview(doc)"
                      >
                        <UIcon name="i-lucide-file-text" class="size-4 text-info shrink-0" />
                        <span class="text-sm truncate flex-1">{{ doc.title }}</span>
                        <UIcon name="i-lucide-external-link" class="size-3.5 text-muted shrink-0" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 本里程碑已提交/已完成工作项 -->
              <div v-if="context.previousArtifacts.currentMilestoneCompleted.workItems.length > 0">
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-2 py-1.5 rounded-md hover:bg-elevated text-left"
                  @click="togglePrevNode('cur-ms')"
                >
                  <UIcon
                    :name="prevExpanded.has('cur-ms') ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    class="size-4 text-muted shrink-0"
                  />
                  <UIcon name="i-lucide-milestone" class="size-4 text-success shrink-0" />
                  <span class="text-sm font-medium truncate flex-1">{{ context.previousArtifacts.currentMilestoneCompleted.milestoneName }}（本里程碑已提交/已完成任务）</span>
                  <UBadge :color="(getPivrStageColor(context.previousArtifacts.currentMilestoneCompleted.pivrStage) as any)" variant="subtle" size="xs">
                    {{ getPivrStageLabel(context.previousArtifacts.currentMilestoneCompleted.pivrStage) }}
                  </UBadge>
                </button>
                <div v-if="prevExpanded.has('cur-ms')" class="pl-6 space-y-0.5 mt-1">
                  <div v-for="wi in context.previousArtifacts.currentMilestoneCompleted.workItems" :key="`cur-wi-${wi.id}`">
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 px-2 py-1.5 rounded-md hover:bg-elevated text-left select-none"
                      @click="togglePrevNode(`cur-wi-${wi.id}`)"
                    >
                      <UIcon
                        :name="prevExpanded.has(`cur-wi-${wi.id}`) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                        class="size-4 text-muted shrink-0"
                      />
                      <UIcon name="i-lucide-square-check" class="size-4 text-success shrink-0" />
                      <span class="text-sm truncate flex-1">{{ wi.itemKey }} {{ wi.title }}</span>
                      <UBadge color="neutral" variant="subtle" size="xs">
                        {{ wi.documents.length }}
                      </UBadge>
                    </button>
                    <div v-if="prevExpanded.has(`cur-wi-${wi.id}`)" class="pl-10 space-y-0.5 mt-1">
                      <button
                        v-for="doc in wi.documents"
                        :key="`cur-wi-doc-${doc.id}`"
                        type="button"
                        class="flex w-full items-center gap-2 px-2 py-1.5 rounded-md hover:bg-elevated text-left"
                        @click="openPreview(doc)"
                      >
                        <UIcon name="i-lucide-file-text" class="size-4 text-info shrink-0" />
                        <span class="text-sm truncate flex-1">{{ doc.title }}</span>
                        <UIcon name="i-lucide-external-link" class="size-3.5 text-muted shrink-0" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </UCard>
        </div>
      </div>

      <!-- 新增任务弹窗 -->
      <UModal v-model:open="showAppendTaskModal" :ui="{ content: 'sm:max-w-3xl' }">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-plus" class="size-5 text-primary" />
            <span class="text-base font-medium">新增任务</span>
          </div>
        </template>
        <template #body>
          <div v-if="appendModalDraft" class="space-y-4 p-4">
            <UFormField label="任务标题" required>
              <UInput
                v-model="appendModalDraft.title"
                placeholder="请输入任务标题"
                class="w-full"
              />
            </UFormField>

            <UFormField label="任务内容">
              <UTextarea
                v-model="appendModalDraft.description"
                :rows="3"
                placeholder="任务内容说明（选填）"
                class="w-full"
              />
            </UFormField>

            <div class="grid gap-3 md:grid-cols-2">
              <UFormField label="负责人" required>
                <USelect
                  v-model="appendModalDraft.assigneeUid"
                  :items="memberOptions"
                  value-key="value"
                  label-key="label"
                  placeholder="请选择负责人"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="预计工时" required>
                <UInput
                  v-model="appendModalDraft.estimatedHours"
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="如 8"
                  class="w-full"
                />
              </UFormField>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <UFormField label="开始日期" required>
                <UInput
                  v-model="appendModalDraft.startDate"
                  type="date"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="结束日期" required>
                <UInput
                  v-model="appendModalDraft.dueDate"
                  type="date"
                  class="w-full"
                />
              </UFormField>
            </div>

            <div class="rounded-md border border-default p-3 space-y-3">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-clipboard-list" class="size-4 text-primary" />
                  <span class="text-sm font-medium">成果要求</span>
                  <span class="text-xs text-muted">{{ appendModalDraft.deliverables.length }} 条</span>
                </div>
                <UButton
                  size="xs"
                  variant="ghost"
                  color="primary"
                  icon="i-lucide-plus"
                  label="追加成果"
                  @click="addAppendDeliverable(appendModalDraft)"
                />
              </div>

              <div
                v-for="d in appendModalDraft.deliverables"
                :key="d.localKey"
                class="rounded-md border border-info/30 bg-info/5 p-2 space-y-2"
              >
                <div class="grid gap-2 md:grid-cols-8">
                  <USelect
                    v-model="d.deliverableType"
                    :items="deliverableTypeOptions"
                    value-key="value"
                    label-key="label"
                    class="md:col-span-2"
                  />
                  <UInput
                    v-model="d.name"
                    placeholder="成果名称"
                    class="md:col-span-6"
                  />
                </div>
                <UInput
                  v-model="d.acceptanceCriteria"
                  placeholder="验收标准（选填）"
                  class="w-full"
                />
                <UTextarea
                  v-model="d.description"
                  :rows="1"
                  placeholder="成果说明（选填）"
                  class="w-full"
                />
                <div class="flex justify-end">
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="error"
                    icon="i-lucide-trash-2"
                    label="移除"
                    :disabled="appendModalDraft.deliverables.length <= 1"
                    @click="removeAppendDeliverable(appendModalDraft, d.localKey)"
                  />
                </div>
              </div>
            </div>

            <div v-if="appendModalIssues.length > 0" class="rounded-lg bg-warning/10 px-3 py-2 space-y-1">
              <div class="text-xs font-medium text-warning">
                完整性检查
              </div>
              <div v-for="issue in appendModalIssues" :key="issue" class="text-xs text-warning">
                · {{ issue }}
              </div>
            </div>
          </div>
        </template>
        <template #footer>
          <div class="flex items-center justify-end gap-2">
            <UButton
              label="取消"
              color="neutral"
              variant="soft"
              :disabled="savingAppend"
              @click="showAppendTaskModal = false"
            />
            <UButton
              label="保存并新增"
              color="primary"
              icon="i-lucide-save"
              :loading="savingAppend"
              :disabled="!appendModalDraft || appendModalIssues.length > 0"
              @click="submitAppendTaskFromModal"
            />
          </div>
        </template>
      </UModal>

      <!-- 文档预览弹窗 -->
      <UModal v-model:open="showDocPreview" :ui="{ content: 'sm:max-w-6xl', body: 'overflow-hidden p-0' }">
        <template #header>
          <span class="text-base font-medium">{{ previewDocTitle || '文档预览' }}</span>
        </template>
        <template #body>
          <div class="h-[70vh] rounded-lg border border-default bg-elevated/40 p-4 min-h-48">
            <AimsDocumentPreview
              v-if="previewDocRef && showDocPreview"
              :source="previewDocRef.source"
              :codocs-uuid="previewDocRef.codocsUuid"
              :project-id="projectId"
              :repo-project-code="previewDocRef.repoProjectCode"
              :repo-file-path="previewDocRef.repoFilePath"
              :repo-commit-id="previewDocRef.repoCommitId"
              :title="previewDocRef.title"
            />
          </div>
        </template>
        <template #footer>
          <div class="flex justify-end">
            <UButton
              label="关闭"
              color="neutral"
              variant="soft"
              @click="showDocPreview = false"
            />
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
