<script setup lang="ts">
import type {
  CreateMilestoneRequest,
  UpdateMilestoneRequest,
  CreateWorkItemRequest,
  WorkItem,
  PivrStage,
  ProjectTemplateVersionDetail,
  ProjectTemplateWorkItemDefinition
} from '~/types/aims'
import { milestoneStatusConfig } from '~/config/milestone'
import { typeConfig, getStatusLabel, getStatusColor } from '~/config/work-item'
import {
  normalizeProjectTemplateVersion,
  type RawProjectTemplateVersion
} from '~/utils/projectTemplateVersions'

// ========================
// 里程碑表单校验
// ========================
function validateMilestoneForm(form: { name?: string, mode?: string, startDate?: string | null, endDate?: string | null }) {
  const errors: Record<string, string> = {}
  if (!form.name?.trim()) {
    errors.name = '请输入里程碑名称'
  }
  if (!form.startDate) {
    errors.startDate = '请选择开始日期'
  }
  if (form.mode === 'strong_constraint' && !form.endDate) {
    errors.endDate = '强约束模式下必须指定结束日期'
  }
  if (form.mode === 'periodic' && !form.endDate) {
    errors.endDate = '周期性模式下必须指定结束日期'
  }
  if (form.startDate && form.endDate && new Date(form.endDate) <= new Date(form.startDate)) {
    errors.endDate = '结束日期必须晚于开始日期'
  }
  return errors
}

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '项目里程碑',
  layoutHeaderProjectSwitcher: true
})

const route = useRoute()
const projectId = computed(() => Number(route.params.id))

const projectStore = useProjectStore()
const milestoneStore = useMilestoneStore()
const workItemStore = useWorkItemStore()
const { users: accountUsers } = useAccountUsers()
const { isApprovalMode } = useApprovalMode()
const { user: authUser } = useAuth()
const toast = useToast()

const project = computed(() => projectStore.currentProject)
const isDraft = computed(() => project.value?.lifecycleStatus === 'draft')
const currentUid = computed(() => authUser.value || '')
const isProjectLeader = computed(() =>
  Boolean(project.value?.leaderUid && project.value.leaderUid === currentUid.value)
)
const projectTemplateVersion = ref<ProjectTemplateVersionDetail | null>(null)

const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const u of accountUsers.value) {
    if (u.realName?.trim()) map.set(u.uid, u.realName.trim())
  }
  return map
})

function getUserName(uid: string | null | undefined) {
  if (!uid) return ''
  return userNameMap.value.get(uid) || uid
}

async function loadProjectTemplateVersion() {
  projectTemplateVersion.value = null
  const templateVersionId = project.value?.templateVersionId
  if (!templateVersionId) return

  try {
    const res = await $fetch<{ code: number, data: RawProjectTemplateVersion | null }>(`/api/v1/project-template-versions/${templateVersionId}`, {
      query: { optional: 1 }
    })
    if (res.code !== 0 || !res.data) return
    projectTemplateVersion.value = normalizeProjectTemplateVersion(res.data)
  } catch (error) {
    const statusCode = getFetchStatusCode(error)
    if (statusCode !== 404) throw error
  }
}

function getFetchStatusCode(error: unknown) {
  const fetchError = error as {
    status?: number
    statusCode?: number
    response?: { status?: number }
  }
  return fetchError.statusCode ?? fetchError.status ?? fetchError.response?.status ?? 0
}

// 项目成员选项（指派用，显示 真实姓名(uid)）
const memberOptions = computed(() => {
  const members = (projectStore.currentProject?.members || []).filter(m => m.status !== 'suspended')
  const nameMap = new Map<string, string>()
  for (const u of accountUsers.value) {
    nameMap.set(u.uid, u.realName?.trim() || '')
  }
  return members.map((m) => {
    const name = m.realName || nameMap.get(m.uid) || ''
    return {
      label: name ? `${name}(${m.uid})` : m.uid,
      value: m.uid
    }
  })
})

// ========================
// 新建工作项
// ========================
const showCreateWorkItemModal = ref(false)
const creatingWorkItem = ref(false)
const createWorkItemForm = ref<CreateWorkItemRequest>({
  type: 'task',
  title: '',
  milestoneId: 0,
  description: '',
  priority: 'P2',
  severity: 'medium',
  assigneeUid: '',
  dueDate: ''
})
const createMilestoneLocked = ref(false)

const milestoneSelectOptions = computed(() => [
  { label: '请选择里程碑', value: 0, disabled: true },
  ...milestoneStore.milestones
    .filter(m => m.status !== 'completed')
    .map(m => ({
      label: m.name,
      value: m.id
    }))
])

const workItemTypeOptionsBase = [
  { label: '任务', value: 'task' },
  { label: '缺陷', value: 'bug' },
  { label: '需求', value: 'requirement' }
]
// P 阶段里程碑禁止添加需求类工作目标
const createWorkItemMilestone = computed(() =>
  milestoneStore.milestones.find(m => m.id === createWorkItemForm.value.milestoneId) || null
)
const createWorkItemIsPlanningStage = computed(() =>
  createWorkItemMilestone.value?.pivrStage === 'P'
)
const workItemTypeOptions = computed(() => {
  if (createWorkItemIsPlanningStage.value) {
    return workItemTypeOptionsBase.filter(opt => opt.value !== 'requirement')
  }
  return workItemTypeOptionsBase
})
watch([() => createWorkItemForm.value.milestoneId, showCreateWorkItemModal], () => {
  if (!showCreateWorkItemModal.value) return
  if (createWorkItemIsPlanningStage.value && createWorkItemForm.value.type === 'requirement') {
    createWorkItemForm.value.type = 'task'
  }
})

const priorityOptions = [
  { label: 'P0 - 紧急', value: 'P0' },
  { label: 'P1 - 高', value: 'P1' },
  { label: 'P2 - 中', value: 'P2' },
  { label: 'P3 - 低', value: 'P3' }
]

// 表单是否被提交过（用于控制错误提示的显示时机）
const workItemFormTouched = ref(false)

const workItemTitleError = computed(() => {
  if (!workItemFormTouched.value) return ''
  return createWorkItemForm.value.title.trim() ? '' : '请输入标题'
})

const workItemMilestoneError = computed(() => {
  if (!workItemFormTouched.value) return ''
  return createWorkItemForm.value.milestoneId ? '' : '请选择里程碑'
})

const canCreateWorkItem = computed(() =>
  createWorkItemForm.value.title.trim() !== ''
  && createWorkItemForm.value.milestoneId > 0
)

async function handleCreateWorkItem() {
  workItemFormTouched.value = true
  if (!canCreateWorkItem.value) return
  creatingWorkItem.value = true
  try {
    await workItemStore.createItem(projectId.value, createWorkItemForm.value)
    showCreateWorkItemModal.value = false
    // 刷新里程碑数据 + 工作项列表
    const mid = createWorkItemForm.value.milestoneId
    if (mid) {
      milestoneWorkItems.value.delete(mid)
      if (expandedMilestoneIds.value.has(mid)) {
        loadMilestoneWorkItems(mid)
      }
    }
    await milestoneStore.fetchMilestones(projectId.value)
  } finally {
    creatingWorkItem.value = false
  }
}

// ========================
// 状态映射
// ========================
const modeLabel: Record<string, string> = {
  strong_constraint: '强约束',
  rolling_plan: '滚动计划',
  periodic: '周期性'
}

const modeColor: Record<string, string> = {
  strong_constraint: 'error',
  rolling_plan: 'info',
  periodic: 'warning'
}

// ========================
// 里程碑展开/折叠 + 工作项加载
// ========================
const expandedMilestoneIds = ref<Set<number>>(new Set())
const milestoneWorkItems = ref(new Map<number, WorkItem[]>())
const milestoneWorkItemsLoading = ref<Set<number>>(new Set())

async function loadMilestoneWorkItems(milestoneId: number) {
  if (milestoneWorkItems.value.has(milestoneId)) return
  milestoneWorkItemsLoading.value.add(milestoneId)
  try {
    const res = await $fetch<{ code: number, data: { items: WorkItem[] } }>(
      `/api/v1/projects/${projectId.value}/work-items`,
      { params: { milestone_id: milestoneId } }
    )
    if (res.code === 0) {
      milestoneWorkItems.value.set(milestoneId, res.data.items)
    }
  } finally {
    milestoneWorkItemsLoading.value.delete(milestoneId)
  }
}

interface WorkItemTreeNode extends WorkItem {
  children: WorkItemTreeNode[]
}

function buildWorkItemTree(items: WorkItem[]): WorkItemTreeNode[] {
  const sorted = [...items].sort((a, b) => a.itemNumber - b.itemNumber)
  const map = new Map<number, WorkItemTreeNode>()
  const roots: WorkItemTreeNode[] = []

  for (const item of sorted) {
    map.set(item.id, { ...item, children: [] })
  }
  for (const item of sorted) {
    const node = map.get(item.id)!
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

interface FlatWorkItemNode extends WorkItem {
  depth: number
  hasChildren: boolean
}

function flattenTree(nodes: WorkItemTreeNode[], depth = 0): FlatWorkItemNode[] {
  const result: FlatWorkItemNode[] = []
  for (const node of nodes) {
    result.push({ ...node, depth, hasChildren: node.children.length > 0 })
    if (node.children.length > 0) {
      result.push(...flattenTree(node.children, depth + 1))
    }
  }
  return result
}

function getMilestoneItemsFlat(milestoneId: number): FlatWorkItemNode[] {
  return flattenTree(buildWorkItemTree(milestoneWorkItems.value.get(milestoneId) || []))
}

function toggleMilestone(id: number) {
  if (expandedMilestoneIds.value.has(id)) {
    expandedMilestoneIds.value.delete(id)
  } else {
    expandedMilestoneIds.value.add(id)
    loadMilestoneWorkItems(id)
    loadProjectDeliverables()
  }
}

// ========================
// 里程碑交付物
// ========================
interface DeliverableItem {
  id: number
  entityType: string
  entityId: number | null
  name: string
  description: string | null
  acceptanceCriteria: string | null
  deliverableType: string
  required: boolean
  status: string
  documentUuid: string | null
  evidenceUrl: string | null
  evidenceNote: string | null
  submittedBy: string | null
  submittedAt: string | null
}

type RawDeliverableItem = Partial<DeliverableItem> & {
  entity_type?: string
  entity_id?: number | null
  target_id?: number | null
  matter_id?: number | null
  project_owner_id?: number | null
  milestone_owner_id?: number | null
  acceptance_criteria?: string | null
  deliverable_type?: string
  document_uuid?: string | null
  evidence_url?: string | null
  evidence_note?: string | null
  submitted_by?: string | null
  submitted_at?: string | null
}

type ListPayload<T> = T[] | {
  items?: T[]
}

function normalizeListPayload<T>(data: ListPayload<T> | null | undefined) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  return []
}

function normalizeDeliverable(raw: RawDeliverableItem): DeliverableItem {
  const entityType = raw.entityType
    ?? raw.entity_type
    ?? (raw.target_id || raw.matter_id ? 'work_item' : raw.milestone_owner_id ? 'milestone' : raw.project_owner_id ? 'project' : '')
  const entityId = raw.entityId
    ?? raw.entity_id
    ?? raw.target_id
    ?? raw.matter_id
    ?? raw.milestone_owner_id
    ?? raw.project_owner_id
    ?? null

  return {
    id: Number(raw.id),
    entityType,
    entityId,
    name: raw.name ?? '',
    description: raw.description ?? null,
    acceptanceCriteria: raw.acceptanceCriteria ?? raw.acceptance_criteria ?? null,
    deliverableType: raw.deliverableType ?? raw.deliverable_type ?? '',
    required: Boolean(raw.required),
    status: raw.status ?? 'pending',
    documentUuid: raw.documentUuid ?? raw.document_uuid ?? null,
    evidenceUrl: raw.evidenceUrl ?? raw.evidence_url ?? null,
    evidenceNote: raw.evidenceNote ?? raw.evidence_note ?? null,
    submittedBy: raw.submittedBy ?? raw.submitted_by ?? null,
    submittedAt: raw.submittedAt ?? raw.submitted_at ?? null
  }
}

// 按工作项ID索引的交付物
const workItemDeliverables = ref(new Map<number, DeliverableItem[]>())
const deliverablesLoaded = ref(false)

// 兼容旧的 milestoneDeliverables（用于头部统计）
const milestoneDeliverables = ref(new Map<number, DeliverableItem[]>())

async function loadProjectDeliverables() {
  if (deliverablesLoaded.value) return
  try {
    const res = await $fetch<{ code: number, data: ListPayload<RawDeliverableItem> }>(
      '/api/v1/deliverables',
      { params: { project_id: projectId.value } }
    )
    if (res.code === 0) {
      const deliverables = normalizeListPayload(res.data).map(normalizeDeliverable)
      // 按工作项分组
      const wiMap = new Map<number, DeliverableItem[]>()
      const msMap = new Map<number, DeliverableItem[]>()
      for (const d of deliverables) {
        if (d.entityType === 'work_item' && d.entityId != null) {
          const list = wiMap.get(d.entityId) || []
          list.push(d)
          wiMap.set(d.entityId, list)
        } else if (d.entityType === 'milestone' && d.entityId != null) {
          const list = msMap.get(d.entityId) || []
          list.push(d)
          msMap.set(d.entityId, list)
        }
      }
      workItemDeliverables.value = wiMap

      // 里程碑交付物 = 里程碑直属交付物 + 该里程碑下工作项交付物
      for (const [msId, items] of milestoneWorkItems.value) {
        const msDeliverables = [...(msMap.get(msId) || [])]
        for (const item of items) {
          const dels = wiMap.get(item.id)
          if (dels) msDeliverables.push(...dels)
        }
        if (msDeliverables.length > 0) {
          msMap.set(msId, msDeliverables)
        }
      }
      milestoneDeliverables.value = msMap

      deliverablesLoaded.value = true
    }
  } catch (err) {
    console.error('[Plan] Failed to load deliverables:', err)
  }
}

function getDeliverableStats(milestoneId: number) {
  const items = milestoneDeliverables.value.get(milestoneId) || []
  const total = items.length
  const approved = items.filter(d => d.status === 'approved').length
  return { approved, total }
}

const deliverableStatusConfig: Record<string, { label: string, color: string }> = {
  pending: { label: '待提交', color: 'neutral' },
  submitted: { label: '已提交', color: 'info' },
  approved: { label: '已通过', color: 'success' },
  rejected: { label: '已驳回', color: 'error' }
}

// 提交交付物弹���
const showSubmitDeliverableModal = ref(false)
const currentDeliverable = ref<DeliverableItem | null>(null)
const submitDocUuid = ref('')
const submitEvidenceUrl = ref('')
const submitEvidenceNote = ref('')
const submittingDeliverable = ref(false)

async function handleSubmitDeliverable() {
  if (!currentDeliverable.value) return
  submittingDeliverable.value = true
  try {
    await $fetch(`/api/v1/deliverables/${currentDeliverable.value.id}`, {
      method: 'PUT',
      body: {
        status: 'submitted',
        documentUuid: submitDocUuid.value || null,
        evidenceUrl: submitEvidenceUrl.value || null,
        evidenceNote: submitEvidenceNote.value || null
      }
    })
    showSubmitDeliverableModal.value = false
    // 刷新该里程碑的交付物
    const milestoneId = [...milestoneDeliverables.value.entries()]
      .find(([_, items]) => items.some(i => i.id === currentDeliverable.value!.id))?.[0]
    if (milestoneId) {
      milestoneDeliverables.value.delete(milestoneId)
      deliverablesLoaded.value = false
      await loadProjectDeliverables()
    }
  } finally {
    submittingDeliverable.value = false
  }
}

// ========================
// 新建里程碑
// ========================
const showCreateMilestoneModal = ref(false)
const inactiveMilestoneWarning = ref(false)
const creatingMilestone = ref(false)
const modeOptions = [
  { label: '滚动计划', value: 'rolling_plan' },
  { label: '强约束', value: 'strong_constraint' },
  { label: '周期性', value: 'periodic' }
]

const pivrStageOptions = [
  { label: '不适用', value: '' },
  { label: 'P - 准备', value: 'P' },
  { label: 'I - 实施', value: 'I' },
  { label: 'V - 验证交付', value: 'V' },
  { label: 'R - 改进', value: 'R' }
]

const createMilestoneForm = ref<CreateMilestoneRequest>({
  name: '',
  description: '',
  mode: 'rolling_plan',
  pivrStage: null,
  startDate: '',
  endDate: ''
})
const createMilestoneTouched = ref(false)
const createMilestoneErrors = computed(() => {
  if (!createMilestoneTouched.value) return {}
  return validateMilestoneForm(createMilestoneForm.value)
})
const canCreateMilestone = computed(() =>
  Object.keys(validateMilestoneForm(createMilestoneForm.value)).length === 0
)

async function handleCreateMilestone() {
  if (!isProjectLeader.value) {
    toast.add({ title: '仅项目负责人可创建里程碑', color: 'warning' })
    return
  }
  createMilestoneTouched.value = true
  if (!canCreateMilestone.value) return
  creatingMilestone.value = true
  try {
    const data = { ...createMilestoneForm.value }
    if (!data.pivrStage) data.pivrStage = null
    await milestoneStore.createMilestone(projectId.value, data)
    showCreateMilestoneModal.value = false
    createMilestoneForm.value = { name: '', description: '', mode: 'rolling_plan', pivrStage: null, startDate: '', endDate: '' }
    createMilestoneTouched.value = false
  } finally {
    creatingMilestone.value = false
  }
}

// ========================
// 编辑里程碑
// ========================
const showEditMilestoneModal = ref(false)
const editingMilestoneId = ref<number | null>(null)
const savingMilestone = ref(false)
const editMilestoneTouched = ref(false)
const editMilestoneForm = ref<UpdateMilestoneRequest>({
  name: '',
  description: '',
  mode: 'rolling_plan',
  pivrStage: null,
  startDate: '',
  endDate: '',
  status: 'planning'
})
const editMilestoneErrors = computed(() => {
  if (!editMilestoneTouched.value) return {}
  return validateMilestoneForm(editMilestoneForm.value)
})
const canEditMilestone = computed(() =>
  Object.keys(validateMilestoneForm(editMilestoneForm.value)).length === 0
)

// 编辑里程碑时的工作项模板列表
interface EditDeliverableItem {
  key: string
  title: string
  type: string
  description?: string | null
  required: boolean
  reviewLevel: number
  priority: string
  deliverables: ProjectTemplateWorkItemDefinition['deliverables']
  selected: boolean
  /** 如果已有对应工作项，记录其 ID */
  existingWorkItemId: number | null
}

const editMilestoneDeliverableItems = ref<EditDeliverableItem[]>([])

const deliverableTypeLabel: Record<string, string> = {
  document: '文档',
  code: '代码',
  artifact: '制品',
  task: '事务'
}

async function loadEditMilestoneDeliverables(milestoneId: number, pivrStage: PivrStage | null) {
  const milestone = milestoneStore.milestones.find(item => item.id === milestoneId)
  if (!projectTemplateVersion.value || !pivrStage || !milestone) {
    editMilestoneDeliverableItems.value = []
    return
  }

  // 强制刷新工作项列表，确保与数据库一致
  milestoneWorkItems.value.delete(milestoneId)
  await loadMilestoneWorkItems(milestoneId)
  const existingItems = milestoneWorkItems.value.get(milestoneId) || []

  const templateMilestone = projectTemplateVersion.value.definition.milestones.find((template) => {
    if (milestone.templateKey) {
      return template.key === milestone.templateKey
    }
    return template.pivrStage === pivrStage && template.name === milestone.name
  })
  const templates = templateMilestone?.workItems || []

  editMilestoneDeliverableItems.value = templates.map((template) => {
    const matched = existingItems.find(
      wi => (wi.templateKey && wi.templateKey === template.key) || wi.title === template.title
    )
    return {
      key: template.key,
      title: template.title,
      type: template.type,
      description: template.description,
      required: template.required,
      reviewLevel: template.reviewLevel,
      priority: template.priority,
      deliverables: template.deliverables,
      selected: !!matched,
      existingWorkItemId: matched?.id ?? null
    }
  })
}

async function _handleCreateRequirementChange(milestone: typeof milestoneStore.milestones[0]) {
  try {
    const res = await $fetch<{ code: number, data: { id: number, itemKey: string, title: string } }>(
      `/api/v1/projects/${projectId.value}/requirement-targets`,
      {
        method: 'POST',
        body: { milestoneId: milestone.id }
      }
    )
    if (res.code === 0) {
      useToast().add({ title: `已创建 ${res.data.itemKey} ${res.data.title}`, color: 'success' })
      navigateTo(`/projects/${projectId.value}/requirements?workItemId=${res.data.id}`)
    }
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message
      || (err as { message?: string })?.message
      || '创建需求变更失败'
    useToast().add({ title: msg, color: 'error' })
  }
}

async function openEditMilestone(milestone: typeof milestoneStore.milestones[0]) {
  editingMilestoneId.value = milestone.id
  editMilestoneForm.value = {
    name: milestone.name,
    description: milestone.description || '',
    mode: milestone.mode,
    pivrStage: milestone.pivrStage || null,
    startDate: milestone.startDate || '',
    endDate: milestone.endDate || '',
    status: milestone.status
  }
  editMilestoneTouched.value = false
  await loadEditMilestoneDeliverables(milestone.id, milestone.pivrStage || null)
  showEditMilestoneModal.value = true
}

async function handleEditMilestone() {
  editMilestoneTouched.value = true
  if (!editingMilestoneId.value || !canEditMilestone.value) return
  savingMilestone.value = true
  try {
    const data = { ...editMilestoneForm.value }
    if (!data.pivrStage) data.pivrStage = null
    await milestoneStore.updateMilestone(editingMilestoneId.value, data, projectId.value)

    // 处理交付物工作项变更
    const milestoneId = editingMilestoneId.value
    const projectCode = projectStore.currentProject?.projectCode || ''

    for (const template of editMilestoneDeliverableItems.value) {
      if (!template.selected && template.existingWorkItemId) {
        // 取消勾选且有已存在的工作项 → 删除
        try {
          await $fetch(`/api/v1/work-items/${template.existingWorkItemId}`, { method: 'DELETE' })
        } catch {
          // 静默处理，可能已被删除
        }
      } else if (template.selected && !template.existingWorkItemId) {
        // 新勾选且无已存在的工作项 → 创建
        try {
          const wiRes = await $fetch<{ code: number, data: { id: number } }>(
            `/api/v1/projects/${projectId.value}/work-items`,
            {
              method: 'POST',
              body: {
                type: template.type,
                tier: 'target',
                title: template.title,
                description: template.description || '',
                milestoneId,
                priority: template.priority,
                reviewLevel: template.reviewLevel ?? 1,
                required: template.required,
                templateKey: template.key
              }
            }
          )
          if (wiRes.code === 0 && wiRes.data?.id) {
            await $fetch('/api/v1/deliverables/batch', {
              method: 'POST',
              body: {
                items: template.deliverables.map((deliverable, index) => ({
                  entityType: 'work_item',
                  entityId: wiRes.data.id,
                  name: deliverable.name,
                  description: deliverable.description || null,
                  acceptanceCriteria: deliverable.acceptanceCriteria,
                  deliverableType: deliverable.deliverableType,
                  required: deliverable.required,
                  sortOrder: deliverable.sortOrder ?? index,
                  projectId: projectId.value,
                  projectCode,
                  templateKey: deliverable.key
                }))
              }
            })
          }
        } catch {
          // 静默处理
        }
      }
    }

    // 刷新工作项列表
    milestoneWorkItems.value.delete(milestoneId)
    await loadMilestoneWorkItems(milestoneId)
    deliverablesLoaded.value = false

    showEditMilestoneModal.value = false
  } finally {
    savingMilestone.value = false
  }
}

// ========================
// 工具函数
// ========================
function formatDate(date: string | null) {
  if (!date) return '-'
  return date.slice(0, 10)
}

function getOverdueDays(endDate: string | null, status: string): number {
  if (!endDate || status !== 'active') return 0
  const end = new Date(endDate.slice(0, 10))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.floor((today.getTime() - end.getTime()) / (1000 * 60 * 60 * 24))
  return diff > 0 ? diff : 0
}

// ========================
// 生命周期
// ========================
onMounted(async () => {
  if (!projectStore.currentProject || projectStore.currentProject.id !== projectId.value) {
    await projectStore.fetchProject(projectId.value)
  }
  await loadProjectTemplateVersion()
  await milestoneStore.fetchMilestones(projectId.value)
  // 默认展开进行中的里程碑
  for (const m of milestoneStore.milestones) {
    if (m.status === 'active') {
      expandedMilestoneIds.value.add(m.id)
    }
  }
  // 并行加载所有里程碑的工作项
  await Promise.all(
    milestoneStore.milestones.map(m => loadMilestoneWorkItems(m.id))
  )
  // 加载全项目交付物（依赖工作项数据，需在之后）
  await loadProjectDeliverables()
})
</script>

<template>
  <UDashboardPanel id="project-plan" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex flex-col h-full min-h-0">
        <ProjectNavbar>
          <!-- <template v-if="!isApprovalMode" #actions>
            <UButton
              icon="i-lucide-plus"
              label="新建工作项"
              color="primary"
              size="sm"
              @click="openCreateWorkItem()"
            />
          </template> -->
        </ProjectNavbar>
        <div class="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-12 space-y-4">
          <!-- 加载中 -->
          <div v-if="milestoneStore.loading" class="flex justify-center py-12">
            <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-muted" />
          </div>

          <!-- 空状态 -->
          <div
            v-else-if="milestoneStore.milestones.length === 0"
            class="text-center py-12 text-muted"
          >
            <UIcon name="i-lucide-flag" class="w-12 h-12 mx-auto mb-3" />
            <p>暂无计划数据</p>
            <div class="flex justify-center mt-3">
              <UButton
                v-if="isProjectLeader"
                label="创建里程碑"
                color="primary"
                variant="soft"
                @click="showCreateMilestoneModal = true"
              />
            </div>
          </div>

          <template v-else>
            <!-- 里程碑列表 -->
            <UCard
              v-for="milestone in milestoneStore.milestones"
              :key="milestone.id"
              :class="{
                'bg-success/5': milestone.status === 'completed',
                'bg-error/5 ring-1 ring-error': milestone.status === 'active' && getOverdueDays(milestone.endDate, milestone.status) > 0,
                'bg-secondary/5 ring-1 ring-secondary': milestone.status === 'active' && getOverdueDays(milestone.endDate, milestone.status) === 0,
                'bg-neutral/5': milestone.status === 'planning'
              }"
            >
              <div class="space-y-3">
                <!-- 里程碑头部：chevron 折叠，其余（包括标题）进详情 -->
                <div
                  class="flex items-center justify-between cursor-pointer"
                  @click="navigateTo(`/projects/${projectId}/milestones/${milestone.id}`)"
                >
                  <div class="flex items-center gap-3">
                    <UButton
                      :icon="expandedMilestoneIds.has(milestone.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      :title="expandedMilestoneIds.has(milestone.id) ? '收起' : '展开'"
                      @click.stop="toggleMilestone(milestone.id)"
                    />
                    <UIcon name="i-lucide-flag" class="w-4 h-4 text-primary" />
                    <h3 class="font-semibold hover:text-primary transition-colors">
                      {{ milestone.name }}
                    </h3>
                    <UBadge :color="(modeColor[milestone.mode] as any)" variant="outline" size="xs">
                      {{ modeLabel[milestone.mode] || milestone.mode }}
                    </UBadge>
                    <UBadge :color="(milestoneStatusConfig[milestone.status]?.color as any)" variant="subtle" size="xs">
                      {{ milestoneStatusConfig[milestone.status]?.label || milestone.status }}
                    </UBadge>
                    <span v-if="milestone.pivrStage" class="text-xs font-mono text-muted">
                      PIVR:{{ milestone.pivrStage }}
                    </span>
                    <template v-if="milestoneWorkItems.has(milestone.id)">
                      <span
                        v-if="milestoneWorkItems.get(milestone.id)!.length === 0"
                        class="text-xs text-muted"
                      >
                        无工作项
                      </span>
                      <span
                        v-else
                        class="text-xs text-muted"
                      >
                        进度 {{ milestone.progress ?? 0 }}%
                        ({{ milestoneWorkItems.get(milestone.id)!.filter(i => i.status === 'completed').length }}/{{ milestoneWorkItems.get(milestone.id)!.length }})
                      </span>
                    </template>
                    <span
                      v-if="milestoneDeliverables.has(milestone.id) && getDeliverableStats(milestone.id).total > 0"
                      class="text-xs"
                      :class="getDeliverableStats(milestone.id).approved === getDeliverableStats(milestone.id).total ? 'text-success' : 'text-muted'"
                    >
                      交付物（{{ getDeliverableStats(milestone.id).approved }}/{{ getDeliverableStats(milestone.id).total }}）
                    </span>
                    <div
                      v-if="milestone.status !== 'completed' && !isApprovalMode"
                      class="flex items-center gap-1 ml-2"
                    >
                      <UButton
                        icon="i-lucide-circle-plus"
                        color="primary"
                        variant="ghost"
                        size="sm"
                        title="新建工作目标"
                        @click.stop="(milestone.status === 'planning' && !isDraft) ? (inactiveMilestoneWarning = true) : navigateTo(`/projects/${projectId}/work-items?milestone=${milestone.id}&create=1`)"
                      />
                      <!-- <UButton
                        v-if="['I', 'V', 'R'].includes(String(milestone.pivrStage))"
                        icon="i-lucide-clipboard-pen"
                        color="warning"
                        variant="ghost"
                        size="xs"
                        title="新建需求变更"
                        @click.stop="handleCreateRequirementChange(milestone)"
                      /> -->
                      <UButton
                        v-if="isDraft || !milestone.startDate || !milestone.endDate"
                        icon="i-lucide-settings"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        title="编辑里程碑"
                        @click.stop="openEditMilestone(milestone)"
                      />
                    <!-- <UButton
                      icon="i-lucide-trash-2"
                      color="error"
                      variant="ghost"
                      size="xs"
                      title="删除里程碑"
                      @click.stop="handleDeleteMilestone(milestone.id)"
                    /> -->
                    </div>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <span class="text-sm text-muted">
                      {{ formatDate(milestone.startDate) }} ~ {{ formatDate(milestone.endDate) }}
                    </span>
                    <UBadge
                      v-if="getOverdueDays(milestone.endDate, milestone.status) > 0"
                      color="error"
                      variant="subtle"
                      size="xs"
                    >
                      逾期 {{ getOverdueDays(milestone.endDate, milestone.status) }} 天
                    </UBadge>
                  </div>
                </div>

                <!-- 里程碑描述 -->
                <div v-if="milestone.description && expandedMilestoneIds.has(milestone.id)" class="text-sm text-muted pl-11">
                  {{ milestone.description }}
                </div>

                <!-- 展开内容：工作项列表（含交付物） -->
                <div
                  v-if="expandedMilestoneIds.has(milestone.id)"
                  class="pl-7 space-y-2"
                >
                  <div
                    v-if="milestoneWorkItemsLoading.has(milestone.id)"
                    class="flex justify-center py-4"
                  >
                    <UIcon
                      name="i-lucide-loader-2"
                      class="w-5 h-5 animate-spin text-muted"
                    />
                  </div>
                  <div
                    v-else-if="!milestoneWorkItems.get(milestone.id)?.length"
                    class="text-sm text-muted py-2 pl-4"
                  >
                    该里程碑下暂无工作项
                  </div>
                  <div
                    v-for="item in getMilestoneItemsFlat(milestone.id)"
                    :key="item.id"
                    class="flex items-center gap-2 py-2 rounded-lg border border-default"
                    :class="isApprovalMode ? 'opacity-80' : 'hover:bg-elevated cursor-pointer'"
                    :style="{ paddingLeft: `${item.depth * 1.5 + 1}rem`, paddingRight: '1rem' }"
                    @click="!isApprovalMode && navigateTo(
                      item.type === 'requirement'
                        ? `/projects/${projectId}/requirements?workItemId=${item.id}`
                        : `/projects/${projectId}/work-items/${item.id}/${(item.templateKey === 'requirement_breakdown' || item.templateKey === 'requirement_change') ? 'decompose' : 'breakdown'}`
                    )"
                  >
                    <UIcon
                      v-if="item.hasChildren"
                      name="i-lucide-corner-down-right"
                      class="size-3.5 text-muted/50 shrink-0"
                    />
                    <UIcon
                      :name="typeConfig[item.type]?.icon || 'i-lucide-circle'"
                      class="size-4 shrink-0"
                      :class="typeConfig[item.type]?.color || 'text-muted'"
                    />
                    <span class="text-xs font-mono text-muted shrink-0">
                      {{ item.itemKey }}
                    </span>
                    <UBadge
                      :color="item.required ? 'error' : 'neutral'"
                      variant="subtle"
                      size="xs"
                      class="shrink-0"
                    >
                      {{ item.required ? '必选' : '可选' }}
                    </UBadge>
                    <UBadge
                      :color="(getStatusColor(item.status) as any)"
                      variant="subtle"
                      size="xs"
                      class="shrink-0"
                    >
                      {{ getStatusLabel(item.status) }}
                    </UBadge>
                    <span class="text-sm truncate min-w-0" style="max-width: 40%;">
                      {{ item.title }}
                    </span>
                    <span
                      v-if="item.assigneeUid"
                      class="text-xs text-muted shrink-0"
                    >
                      {{ getUserName(item.assigneeUid) }}
                    </span>
                    <div class="flex-1" />
                    <!-- 交付物信息（最右边） -->
                    <template v-for="d in workItemDeliverables.get(item.id) || []" :key="d.id">
                      <span class="text-xs text-muted shrink-0">交付成果：{{ d.name }}</span>
                      <UBadge
                        :color="d.required ? 'error' : 'neutral'"
                        variant="subtle"
                        size="xs"
                        class="shrink-0"
                      >
                        {{ d.required ? '必选' : '可选' }}
                      </UBadge>
                      <UBadge
                        :color="(deliverableStatusConfig[d.status]?.color as any) || 'neutral'"
                        variant="subtle"
                        size="xs"
                        class="shrink-0"
                      >
                        {{ deliverableStatusConfig[d.status]?.label || d.status }}
                      </UBadge>
                    </template>
                  </div>
                </div>
              </div>
            </UCard>
          </template>

          <!-- 新建里程碑弹窗 -->
          <UModal v-model:open="showCreateMilestoneModal">
            <template #header>
              <h3 class="text-lg font-semibold">
                新建里程碑
              </h3>
            </template>
            <template #body>
              <div class="space-y-4 p-4">
                <UFormField label="里程碑名称" required :error="createMilestoneErrors.name">
                  <UInput v-model="createMilestoneForm.name" placeholder="如：v1.0 发布" class="w-full" />
                </UFormField>
                <div class="grid grid-cols-2 gap-4">
                  <UFormField label="模式" required>
                    <USelect v-model="(createMilestoneForm.mode as string)" :items="modeOptions" class="w-full" />
                    <p v-if="createMilestoneForm.mode === 'strong_constraint'" class="text-xs text-warning mt-1">
                      强约束模式需要指定结束日期
                    </p>
                    <p v-else-if="createMilestoneForm.mode === 'periodic'" class="text-xs text-warning mt-1">
                      周期性模式需要指定结束日期
                    </p>
                    <p v-else class="text-xs text-muted mt-1">
                      滚动计划模式下结束日期为可选
                    </p>
                  </UFormField>
                  <UFormField label="PIVR 阶段">
                    <USelect
                      :model-value="(createMilestoneForm.pivrStage as string) || ''"
                      :items="pivrStageOptions"
                      class="w-full"
                      @update:model-value="createMilestoneForm.pivrStage = ($event || null) as any"
                    />
                  </UFormField>
                </div>
                <UFormField label="描述">
                  <UTextarea v-model="createMilestoneForm.description!" placeholder="描述里程碑的目标和范围" class="w-full" />
                </UFormField>
                <div class="grid grid-cols-2 gap-4">
                  <UFormField label="开始日期" required :error="createMilestoneErrors.startDate">
                    <UInput v-model="createMilestoneForm.startDate!" type="date" class="w-full" />
                  </UFormField>
                  <UFormField
                    label="结束日期"
                    :required="createMilestoneForm.mode === 'strong_constraint' || createMilestoneForm.mode === 'periodic'"
                    :error="createMilestoneErrors.endDate"
                  >
                    <UInput v-model="createMilestoneForm.endDate!" type="date" class="w-full" />
                  </UFormField>
                </div>
              </div>
            </template>
            <template #footer>
              <div class="flex justify-end gap-2">
                <UButton
                  label="取消"
                  color="neutral"
                  variant="ghost"
                  @click="showCreateMilestoneModal = false"
                />
                <UButton
                  label="创建"
                  color="primary"
                  :loading="creatingMilestone"
                  @click="handleCreateMilestone"
                />
              </div>
            </template>
          </UModal>

          <!-- 编辑里程碑弹窗 -->
          <UModal v-model:open="showEditMilestoneModal">
            <template #header>
              <h3 class="text-lg font-semibold">
                编辑里程碑
              </h3>
            </template>
            <template #body>
              <div class="space-y-4 p-4">
                <UFormField label="里程碑名称" required :error="editMilestoneErrors.name">
                  <UInput v-model="editMilestoneForm.name!" placeholder="里程碑名称" class="w-full" />
                </UFormField>
                <!-- 模式、状态、PIVR 阶段（只读，一行三列） -->
                <div class="grid grid-cols-3 gap-4">
                  <UFormField label="模式">
                    <USelect
                      v-model="(editMilestoneForm.mode as string)"
                      :items="modeOptions"
                      class="w-full"
                      disabled
                    />
                  </UFormField>
                  <UFormField label="状态">
                    <USelect
                      v-model="(editMilestoneForm.status as string)"
                      :items="[
                        { label: '规划中', value: 'planning' },
                        { label: '待开始', value: 'todo' },
                        { label: '进行中', value: 'active' },
                        { label: '已完成', value: 'completed' }
                      ]"
                      class="w-full"
                      disabled
                    />
                  </UFormField>
                  <UFormField label="PIVR 阶段">
                    <USelect
                      :model-value="(editMilestoneForm.pivrStage as string) || ''"
                      :items="pivrStageOptions"
                      class="w-full"
                      disabled
                    />
                  </UFormField>
                </div>
                <UFormField label="描述">
                  <UTextarea v-model="editMilestoneForm.description!" placeholder="描述里程碑的目标和范围" class="w-full" />
                </UFormField>
                <!-- 工作项模板清单 -->
                <div v-if="editMilestoneDeliverableItems.length > 0">
                  <p class="text-sm font-medium mb-2">
                    工作项模板
                  </p>
                  <div class="space-y-2 rounded-lg border border-default p-3">
                    <div
                      v-for="(d, i) in editMilestoneDeliverableItems"
                      :key="i"
                      class="flex items-start gap-3 py-1"
                    >
                      <input
                        v-model="d.selected"
                        type="checkbox"
                        class="mt-0.5 rounded border-default text-primary focus:ring-primary"
                        :disabled="d.required"
                      >
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="font-medium text-sm">{{ d.title }}</span>
                          <UBadge color="neutral" variant="subtle" size="xs">
                            {{ d.type }}
                          </UBadge>
                          <UBadge
                            v-if="d.required"
                            color="error"
                            variant="subtle"
                            size="xs"
                          >
                            必选
                          </UBadge>
                        </div>
                        <p v-if="d.description" class="text-xs text-muted mt-0.5">
                          {{ d.description }}
                        </p>
                        <div class="mt-2 space-y-1">
                          <div
                            v-for="deliverable in d.deliverables"
                            :key="deliverable.key"
                            class="flex items-center gap-2 text-xs"
                          >
                            <span>{{ deliverable.name }}</span>
                            <UBadge color="neutral" variant="subtle" size="xs">
                              {{ deliverableTypeLabel[deliverable.deliverableType] || deliverable.deliverableType }}
                            </UBadge>
                            <UBadge
                              :color="deliverable.required ? 'error' : 'neutral'"
                              variant="subtle"
                              size="xs"
                            >
                              {{ deliverable.required ? '必交' : '可交' }}
                            </UBadge>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <UFormField label="开始日期" required :error="editMilestoneErrors.startDate">
                    <UInput v-model="editMilestoneForm.startDate!" type="date" class="w-full" />
                  </UFormField>
                  <UFormField
                    label="结束日期"
                    :required="editMilestoneForm.mode === 'strong_constraint' || editMilestoneForm.mode === 'periodic'"
                    :error="editMilestoneErrors.endDate"
                  >
                    <UInput v-model="editMilestoneForm.endDate!" type="date" class="w-full" />
                  </UFormField>
                </div>
              </div>
            </template>
            <template #footer>
              <div class="flex justify-end gap-2">
                <UButton
                  label="取消"
                  color="neutral"
                  variant="ghost"
                  @click="showEditMilestoneModal = false"
                />
                <UButton
                  label="保存"
                  color="primary"
                  :loading="savingMilestone"
                  @click="handleEditMilestone"
                />
              </div>
            </template>
          </UModal>

          <!-- 新建工作项弹窗 -->
          <UModal v-model:open="showCreateWorkItemModal">
            <template #header>
              <h3 class="text-lg font-semibold">
                新建工作项
              </h3>
            </template>
            <template #body>
              <div class="space-y-4 p-4">
                <UFormField
                  label="里程碑"
                  required
                  :error="workItemMilestoneError"
                >
                  <USelect
                    v-model.number="createWorkItemForm.milestoneId"
                    :items="milestoneSelectOptions"
                    placeholder="选择里程碑"
                    class="w-full"
                    :disabled="createMilestoneLocked"
                  />
                </UFormField>
                <UFormField
                  label="类型"
                  required
                  :hint="createWorkItemIsPlanningStage ? 'P 阶段不允许新增需求类工作目标' : undefined"
                >
                  <USelect
                    v-model="(createWorkItemForm.type as string)"
                    :items="workItemTypeOptions"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="标题"
                  required
                  :error="workItemTitleError"
                >
                  <UInput
                    v-model="createWorkItemForm.title"
                    placeholder="输入标题"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="描述">
                  <UTextarea
                    v-model="createWorkItemForm.description!"
                    placeholder="输入描述"
                    class="w-full"
                    :rows="3"
                  />
                </UFormField>
                <div class="grid grid-cols-2 gap-4">
                  <UFormField label="优先级">
                    <USelect
                      v-model="(createWorkItemForm.priority as string)"
                      :items="priorityOptions"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField label="指派给">
                    <USelectMenu
                      v-model="(createWorkItemForm.assigneeUid as string)"
                      :items="memberOptions"
                      value-key="value"
                      label-key="label"
                      placeholder="选择成员"
                      class="w-full"
                      searchable
                    />
                  </UFormField>
                </div>
                <UFormField label="截止日期">
                  <UInput
                    v-model="createWorkItemForm.dueDate!"
                    type="date"
                    class="w-full"
                  />
                </UFormField>
              </div>
            </template>
            <template #footer>
              <div class="flex justify-end gap-2">
                <UButton
                  label="取消"
                  color="neutral"
                  variant="ghost"
                  @click="showCreateWorkItemModal = false"
                />
                <UButton
                  label="创建"
                  color="primary"
                  :loading="creatingWorkItem"
                  :disabled="!canCreateWorkItem && workItemFormTouched"
                  @click="handleCreateWorkItem"
                />
              </div>
            </template>
          </UModal>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <!-- 里程碑未激活提示 -->
  <UModal v-model:open="inactiveMilestoneWarning">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-alert-triangle" class="size-5 text-warning" />
        <h3 class="text-lg font-semibold">
          里程碑尚未启动
        </h3>
      </div>
    </template>
    <template #body>
      <div class="p-4">
        <p class="text-sm">
          该里程碑当前为"规划中"状态，请先编辑里程碑设置起止日期，将状态改为"进行中"后再创建工作项。
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end">
        <UButton
          label="知道了"
          color="primary"
          @click="inactiveMilestoneWarning = false"
        />
      </div>
    </template>
  </UModal>

  <!-- 提交交付物弹窗 -->
  <UModal v-model:open="showSubmitDeliverableModal">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-upload" class="size-5 text-primary" />
        <h3 class="text-lg font-semibold">
          提交交付物
        </h3>
      </div>
    </template>
    <template #body>
      <div v-if="currentDeliverable" class="space-y-4 p-4">
        <div class="rounded-lg bg-elevated p-3 space-y-1">
          <div class="text-sm font-medium">
            {{ currentDeliverable.name }}
          </div>
          <div v-if="currentDeliverable.acceptanceCriteria" class="text-xs text-muted">
            验收标准：{{ currentDeliverable.acceptanceCriteria }}
          </div>
        </div>

        <UFormField
          v-if="currentDeliverable.deliverableType === 'document'"
          label="关联文档 UUID"
          description="粘贴 Codocs 文档 UUID"
        >
          <UInput
            v-model="submitDocUuid"
            placeholder="文档 UUID"
            class="w-full font-mono"
          />
        </UFormField>

        <UFormField
          v-if="currentDeliverable.deliverableType === 'code'"
          label="代码链接"
          description="如 GitLab MR 地址、Tag 地址等"
        >
          <UInput
            v-model="submitEvidenceUrl"
            placeholder="https://..."
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="currentDeliverable.deliverableType === 'artifact'"
          label="制品链接"
          description="如部署地址、安装包地址等"
        >
          <UInput
            v-model="submitEvidenceUrl"
            placeholder="https://..."
            class="w-full"
          />
        </UFormField>

        <UFormField label="提交说明">
          <UTextarea
            v-model="submitEvidenceNote"
            placeholder="补充说明（可选）"
            class="w-full"
            :rows="3"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          @click="showSubmitDeliverableModal = false"
        />
        <UButton
          label="提交"
          color="primary"
          :loading="submittingDeliverable"
          @click="handleSubmitDeliverable"
        />
      </div>
    </template>
  </UModal>
</template>
