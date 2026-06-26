<script setup lang="ts">
import type { WorkItemType } from '~/types/aims'
import { typeConfig, priorityConfig, getStatusColor, getStatusLabel } from '~/config/work-item'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '任务执行',
  layoutHeaderProjectSwitcher: false
})

const { resolveCurrentAppUrl } = useAppUrls()

interface DeliverableItem {
  id: number
  name: string
  description: string | null
  acceptanceCriteria: string | null
  deliverableType: string
  required: boolean
  status: string
  documentUuid: string | null
  documentTitle: string | null
  documentSource: 'codocs' | 'repo'
  repoProjectCode: string | null
  repoFilePath: string | null
  repoCommitId: string | null
  evidenceUrl: string | null
  evidenceNote: string | null
  submittedBy: string | null
  submittedAt: string | null
  createdAt: string
  updatedAt: string
}

interface CommitItem {
  id: number
  repoProjectCode: string
  commitSha: string
  message: string
  authorName: string | null
  authorEmail: string | null
  committedAt: string
  additions: number | null
  deletions: number | null
  filesChanged: number | null
}

interface TimeEntryItem {
  id: number
  uid: string
  entryDate: string
  hours: number
  description: string | null
  createdAt: string
}

interface ExecutionContextData {
  item: {
    id: number
    projectId: number
    projectCode: string
    milestoneId: number
    milestoneName: string
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
    createdAt: string
    updatedAt: string
    parentItemKey: string | null
    parentTitle: string | null
    templateKey: string | null
    requirementCategory: string | null
    decompositionSourceId: number | null
    decompositionSourceKey: string | null
  }
  deliverables: DeliverableItem[]
  commits: CommitItem[]
  timeEntries: TimeEntryItem[]
}

interface GitlabCommitOption {
  id: number
  workItemId: number | null
  itemKey: string | null
  repoProjectCode: string
  commitSha: string
  message: string
  authorName: string | null
  authorEmail: string | null
  committedAt: string
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

const route = useRoute()
const toast = useToast()
const { users: accountUsers } = useAccountUsers()
const { isApprovalMode } = useApprovalMode()
const projectStore = useProjectStore()
const { isWorkItemEditable, workItemReadonlyReason } = storeToRefs(projectStore)
const { user: currentUserUid } = useAuth()

const projectId = computed(() => Number(route.params.id))
const workItemId = computed(() => Number(route.params.workItemId))

const loading = ref(false)
const submittingReview = ref(false)
const syncingGitlab = ref(false)
const context = ref<ExecutionContextData | null>(null)

// 工时表单
const showTimeForm = ref(false)
const timeForm = reactive({
  entryDate: new Date().toISOString().slice(0, 10),
  hours: 0.5,
  description: ''
})
const savingTime = ref(false)

// 需求变更 clone
const cloningChange = ref(false)

async function cloneRequirementChange() {
  if (!context.value) return
  cloningChange.value = true
  try {
    const res = await $fetch<{ code: number, data: { id: number, itemKey: string, round: number } }>(
      `/api/v1/work-items/${workItemId.value}/clone-from-template`,
      { method: 'POST' }
    )
    toast.add({
      title: '已创建新一轮变更',
      description: `新工作项：${res.data.itemKey}（第 ${res.data.round} 轮）`,
      color: 'success'
    })
    navigateTo(`/projects/${projectId.value}/work-items/${res.data.id}/decompose`)
  } catch (error: unknown) {
    const msg = (error as { data?: { message?: string } })?.data?.message || (error as Error).message
    toast.add({ title: '克隆失败', description: msg, color: 'error' })
  } finally {
    cloningChange.value = false
  }
}

// 关联提交弹窗
const showCommitModal = ref(false)
const commitSearchKeyword = ref('')
const availableCommits = ref<GitlabCommitOption[]>([])
const loadingCommits = ref(false)

// diff 弹窗
const showDiffModal = ref(false)
const diffCommitInfo = ref<CommitItem | null>(null)
const loadingDiff = ref(false)
const diffData = ref<Array<{ oldPath: string, newPath: string, newFile: boolean, renamedFile: boolean, deletedFile: boolean, diff: string }>>([])
const expandedCommitId = ref<number | null>(null)

async function openDiffModal(commit: CommitItem) {
  diffCommitInfo.value = commit
  showDiffModal.value = true
  loadingDiff.value = true
  diffData.value = []
  try {
    const res = await $fetch<{ code: number, data: typeof diffData.value }>(
      `/api/v1/work-items/${workItemId.value}/commits/${commit.id}/diff`
    )
    if (res.code === 0) {
      diffData.value = res.data
      // 更新本地 commit 的文件数
      if (context.value) {
        const c = context.value.commits.find(x => x.id === commit.id)
        if (c) {
          c.filesChanged = res.data.length
        }
      }
    }
  } catch {
    diffData.value = []
  } finally {
    loadingDiff.value = false
  }
}

function toggleDiff(commitId: number) {
  if (expandedCommitId.value === commitId) {
    expandedCommitId.value = null
  } else {
    expandedCommitId.value = commitId
    // 加载 diff 数据
    loadingDiff.value = true
    $fetch<{ code: number, data: typeof diffData.value }>(
      `/api/v1/work-items/${workItemId.value}/commits/${commitId}/diff`
    ).then((res) => {
      if (res.code === 0) {
        diffData.value = res.data
      }
    }).catch(() => {
      diffData.value = []
    }).finally(() => {
      loadingDiff.value = false
    })
  }
}

// 交付物证据编辑
const editingDeliverableId = ref<number | null>(null)
const evidenceForm = reactive({
  evidenceUrl: '',
  evidenceNote: ''
})

// 提交成果弹窗：选择项目文档（统一 AimsDocumentPicker）
const showSubmitDocModal = ref(false)
const submittingDeliverableId = ref<number | null>(null)
const submittingDeliverableName = ref('')
const submittingInitialDocRef = ref<import('~/composables/useAimsDocumentPicker').DocumentRef | null>(null)

// 已提交文档预览弹窗
const showDocPreviewModal = ref(false)
const previewDocTitle = ref('')
const previewDocRef = ref<import('~/composables/useAimsDocumentPicker').DocumentRef | null>(null)

// 完成说明
const completionNote = ref('')
const savedCompletionNote = ref('')
const canSaveCompletionNote = computed(() => {
  const noteText = completionNote.value.trim()
  return noteText.length > 0 && noteText !== savedCompletionNote.value
})

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

function formatDate(value: string | null | undefined) {
  if (!value) return '未设置'
  return value.slice(0, 10)
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

const currentPriorityBadge = computed(() => {
  if (!context.value) return null
  const priority = context.value.item.priority as keyof typeof priorityConfig
  return priorityConfig[priority] || null
})

const totalHours = computed(() => {
  if (!context.value) return 0
  return context.value.timeEntries.reduce((sum, e) => sum + Number(e.hours || 0), 0)
})

function normalizeDateOnly(value: string | null | undefined): string | null {
  if (!value) return null
  return value.slice(0, 10)
}

const plannedStartDate = computed(() => normalizeDateOnly(context.value?.item.startDate))
const plannedDueDate = computed(() => normalizeDateOnly(context.value?.item.dueDate))
const timeEntryDateWarning = computed(() => {
  const entryDate = normalizeDateOnly(timeForm.entryDate)
  if (!entryDate) return ''

  const startDate = plannedStartDate.value
  const dueDate = plannedDueDate.value

  if (startDate && entryDate < startDate) {
    return `录入日期早于计划开始日期（${startDate}）`
  }
  if (dueDate && entryDate > dueDate) {
    return `录入日期晚于计划结束日期（${dueDate}）`
  }
  return ''
})

/** 格式化工时：6.50 → 6.5；8.00 → 8；null → '-' */
function formatHours(h: number | string | null | undefined): string {
  if (h === null || h === undefined || h === '') return '-'
  const n = Number(h)
  if (!Number.isFinite(n)) return '-'
  return Number(n.toFixed(2)).toString()
}

const commitStats = computed(() => {
  if (!context.value) return null
  const commits = context.value.commits
  if (commits.length === 0) return null
  let files = 0
  let additions = 0
  let deletions = 0
  for (const c of commits) {
    files += c.filesChanged ?? 0
    additions += c.additions ?? 0
    deletions += c.deletions ?? 0
  }
  return { count: commits.length, files, additions, deletions }
})

const isAssignee = computed(() => {
  return !!(context.value && currentUserUid.value && context.value.item.assigneeUid === currentUserUid.value)
})

const isExecutionReadonly = computed(() => {
  const status = context.value?.item.status
  return status === 'in_review' || status === 'completed'
})

function mapWorkflowFinalStatusToWorkItemStatus(status: string): 'completed' | 'in_progress' | null {
  if (status === 'approved') return 'completed'
  if (status === 'rejected') return 'in_progress'
  return null
}

async function reconcileCompletionReviewStatus(item: ExecutionContextData['item']) {
  if (item.status !== 'in_review') return false
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

    const nextStatus = mapWorkflowFinalStatusToWorkItemStatus(wfStatus)
    if (!nextStatus) return false

    await $fetch(`/api/v1/work-items/${item.id}`, {
      method: 'PUT',
      body: { status: nextStatus }
    })
    return true
  } catch {
    return false
  }
}

async function loadContext() {
  loading.value = true
  try {
    const [projectRes, ctxRes] = await Promise.all([
      projectStore.fetchProject(projectId.value),
      $fetch<{ code: number, data: ExecutionContextData }>(`/api/v1/work-items/${workItemId.value}/execution-context`)
    ])
    void projectRes
    if (ctxRes.code === 0) {
      let nextContext = ctxRes.data

      // 兜底同步：若已提交完成确认且流程已完结，自动回写业务状态
      const reconciled = await reconcileCompletionReviewStatus(nextContext.item)
      if (reconciled) {
        const refreshed = await $fetch<{ code: number, data: ExecutionContextData }>(`/api/v1/work-items/${workItemId.value}/execution-context`)
        if (refreshed.code === 0) {
          nextContext = refreshed.data
        }
      }

      context.value = nextContext
      completionNote.value = ''
      savedCompletionNote.value = ''
    }
  } finally {
    loading.value = false
  }
}

// ====== 工时 ======
const editingTimeEntryId = ref<number | null>(null)

function toggleTimeForm() {
  if (isExecutionReadonly.value || workflowReadonly.value || isApprovalMode.value || !isAssignee.value) return
  if (showTimeForm.value) {
    showTimeForm.value = false
    editingTimeEntryId.value = null
    return
  }
  showTimeForm.value = true
  editingTimeEntryId.value = null
  timeForm.entryDate = new Date().toISOString().slice(0, 10)
  timeForm.hours = 0.5
  timeForm.description = ''
}

function startEditTimeEntry(entry: TimeEntryItem) {
  if (!isAssignee.value || workflowReadonly.value || isApprovalMode.value || isExecutionReadonly.value) return
  if (entry.uid !== currentUserUid.value) return
  editingTimeEntryId.value = entry.id
  showTimeForm.value = true
  timeForm.entryDate = entry.entryDate.slice(0, 10)
  timeForm.hours = Number(entry.hours)
  timeForm.description = entry.description || ''
}

function cancelTimeEdit() {
  showTimeForm.value = false
  editingTimeEntryId.value = null
}

async function saveTimeEntry() {
  if (isExecutionReadonly.value) {
    toast.add({ title: '任务确认中或已完成，不能再记录工时', color: 'warning' })
    return
  }
  if (!timeForm.hours || Number(timeForm.hours) <= 0) {
    toast.add({ title: '请填写有效工时', color: 'error' })
    return
  }
  if (timeEntryDateWarning.value) {
    const start = plannedStartDate.value || '-'
    const due = plannedDueDate.value || '-'
    toast.add({
      title: '日期超出计划范围',
      description: `${timeEntryDateWarning.value}。计划日期：${start} ~ ${due}，将继续记录工时。`,
      color: 'warning'
    })
  }
  savingTime.value = true
  try {
    if (editingTimeEntryId.value) {
      await $fetch(`/api/v1/work-items/${workItemId.value}/time-entries/${editingTimeEntryId.value}`, {
        method: 'PATCH',
        body: {
          entryDate: timeForm.entryDate,
          hours: Number(timeForm.hours),
          description: timeForm.description || null
        }
      })
      toast.add({ title: '工时已更新', color: 'success' })
    } else {
      await $fetch(`/api/v1/work-items/${workItemId.value}/time-entries`, {
        method: 'POST',
        body: {
          entryDate: timeForm.entryDate,
          hours: Number(timeForm.hours),
          description: timeForm.description || null
        }
      })
      toast.add({ title: '工时已记录', color: 'success' })
    }
    showTimeForm.value = false
    editingTimeEntryId.value = null
    await loadContext()
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '保存失败'
    toast.add({ title: msg, color: 'error' })
  } finally {
    savingTime.value = false
  }
}

async function deleteTimeEntry(entryId: number) {
  if (isExecutionReadonly.value) {
    toast.add({ title: '任务确认中或已完成，不能再修改工时', color: 'warning' })
    return
  }
  if (!confirm('确定删除该条工时记录？')) return
  try {
    await $fetch(`/api/v1/work-items/${workItemId.value}/time-entries/${entryId}`, { method: 'DELETE' })
    if (editingTimeEntryId.value === entryId) {
      showTimeForm.value = false
      editingTimeEntryId.value = null
    }
    await loadContext()
    toast.add({ title: '工时已删除', color: 'success' })
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '删除失败'
    toast.add({ title: msg, color: 'error' })
  }
}

// ====== 关联提交 ======
async function syncGitlab() {
  syncingGitlab.value = true
  try {
    const res = await $fetch<{ code: number, data: { message: string, synced: number } }>(
      `/api/v1/projects/${projectId.value}/sync-gitlab`,
      { method: 'POST' }
    )
    if (res.code === 0) {
      toast.add({ title: res.data.message, color: 'success' })
      await loadContext()
      if (showCommitModal.value) {
        await searchCommits()
      }
    }
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '同步失败'
    toast.add({ title: msg, color: 'error' })
  } finally {
    syncingGitlab.value = false
  }
}

async function openCommitModal() {
  showCommitModal.value = true
  commitSearchKeyword.value = ''
  await searchCommits()
}

async function searchCommits() {
  loadingCommits.value = true
  try {
    const res = await $fetch<{ code: number, data: GitlabCommitOption[] }>(
      `/api/v1/projects/${projectId.value}/gitlab-commits`,
      { params: { unlinked: 'true', uid: currentUserUid.value || undefined, keyword: commitSearchKeyword.value || undefined } }
    )
    if (res.code === 0) {
      availableCommits.value = res.data
    }
  } finally {
    loadingCommits.value = false
  }
}

async function linkCommit(commitId: number) {
  await $fetch(`/api/v1/work-items/${workItemId.value}/commits`, {
    method: 'POST',
    body: { commitId }
  })
  await Promise.all([loadContext(), searchCommits()])
  toast.add({ title: '已关联提交', color: 'success' })
  // 异步获取 diff 回填文件数（不阻塞 UI）
  $fetch<{ code: number, data: unknown[] }>(
    `/api/v1/work-items/${workItemId.value}/commits/${commitId}/diff`
  ).then((res) => {
    if (res.code === 0 && context.value) {
      const commit = context.value.commits.find(c => c.id === commitId)
      if (commit) {
        commit.filesChanged = res.data.length
      }
    }
  }).catch(() => {})
}

async function unlinkCommit(commitId: number) {
  await $fetch(`/api/v1/work-items/${workItemId.value}/commits/${commitId}`, {
    method: 'DELETE'
  })
  await loadContext()
  toast.add({ title: '已取消关联', color: 'success' })
}

// ====== 交付物证据 ======
function startEditEvidence(d: DeliverableItem) {
  editingDeliverableId.value = d.id
  evidenceForm.evidenceUrl = d.evidenceUrl || ''
  evidenceForm.evidenceNote = d.evidenceNote || ''
}

function cancelEditEvidence() {
  editingDeliverableId.value = null
}

async function saveEvidence(deliverableId: number) {
  await $fetch(`/api/v1/work-items/${workItemId.value}/deliverables/${deliverableId}`, {
    method: 'PATCH',
    body: {
      evidenceUrl: evidenceForm.evidenceUrl || null,
      evidenceNote: evidenceForm.evidenceNote || null
    }
  })
  editingDeliverableId.value = null
  await loadContext()
  toast.add({ title: '证据已保存', color: 'success' })
}

function openSubmitDocModal(d: DeliverableItem) {
  if (isExecutionReadonly.value || !isWorkItemEditable.value || !isAssignee.value || workflowReadonly.value || isApprovalMode.value) return
  submittingDeliverableId.value = d.id
  submittingDeliverableName.value = d.name
  // 恢复当前已绑定的来源
  submittingInitialDocRef.value = d.documentSource === 'repo'
    ? {
        source: 'repo',
        title: d.documentTitle || d.name,
        repoProjectCode: d.repoProjectCode,
        repoFilePath: d.repoFilePath,
        repoCommitId: d.repoCommitId
      }
    : d.documentUuid
      ? {
          source: 'codocs',
          title: d.documentTitle || d.name,
          codocsUuid: d.documentUuid
        }
      : null
  showSubmitDocModal.value = true
}

async function handleDeliverableDocSelected(docRef: import('~/composables/useAimsDocumentPicker').DocumentRef) {
  if (!submittingDeliverableId.value) return
  try {
    await $fetch(`/api/v1/work-items/${workItemId.value}/deliverables/${submittingDeliverableId.value}`, {
      method: 'PATCH',
      body: {
        status: 'submitted',
        documentSource: docRef.source,
        documentUuid: docRef.source === 'codocs' ? docRef.codocsUuid : null,
        documentTitle: docRef.title,
        repoProjectCode: docRef.source === 'repo' ? docRef.repoProjectCode : null,
        repoFilePath: docRef.source === 'repo' ? docRef.repoFilePath : null,
        repoCommitId: docRef.source === 'repo' ? docRef.repoCommitId : null
      }
    })
    await loadContext()
    toast.add({ title: '文档已关联', color: 'success' })
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '保存失败'
    toast.add({ title: msg, color: 'error' })
  }
}

function openDocPreview(d: DeliverableItem) {
  if (d.documentSource === 'repo') {
    if (!d.repoFilePath || !d.repoProjectCode) return
    previewDocRef.value = {
      source: 'repo',
      title: d.documentTitle || d.name,
      repoProjectCode: d.repoProjectCode,
      repoFilePath: d.repoFilePath,
      repoCommitId: d.repoCommitId
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
  showDocPreviewModal.value = true
}

async function submitGenericDeliverable(deliverableId: number) {
  try {
    await $fetch(`/api/v1/work-items/${workItemId.value}/deliverables/${deliverableId}`, {
      method: 'PATCH',
      body: { status: 'submitted' }
    })
    await loadContext()
    toast.add({ title: '成果已提交', color: 'success' })
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '提交失败'
    toast.add({ title: msg, color: 'error' })
  }
}

// ====== 完整性检查 ======
const completenessIssues = computed(() => {
  const issues: string[] = []
  if (!context.value) return issues
  const { deliverables, commits, timeEntries } = context.value
  // 必须交付物需有产出证据
  //   - 文档类：已关联项目文档
  //   - 代码类：该工作项至少关联一条代码提交
  //   - 其它类：有证据链接/说明 或 status 已非 pending
  const requiredMissing = deliverables.filter((d) => {
    if (!d.required) return false
    if (d.deliverableType === 'document') return !d.documentUuid
    if (d.deliverableType === 'code') return commits.length === 0
    return d.status === 'pending' && !d.evidenceUrl && !d.evidenceNote
  })
  if (requiredMissing.length > 0) {
    issues.push(`${requiredMissing.length} 项必须交付物尚未完成`)
  }
  // 至少有工时记录
  if (timeEntries.length === 0) {
    issues.push('尚无工时记录')
  }
  // 存在代码类成果时，必须至少关联一条代码提交
  const hasCodeDeliverable = deliverables.some(d => d.deliverableType === 'code')
  if (hasCodeDeliverable && commits.length === 0) {
    issues.push('代码类成果需关联至少一条代码提交')
  }
  return issues
})

// ====== 页面流程声明：任务完成确认 ======
const { isReadonly: workflowReadonly } = usePageWorkflow({
  appCode: 'aims',
  resourceCode: 'tasks',
  bizId: computed(() => String(workItemId.value)),
  bizTitle: computed(() => {
    if (!context.value) return ''
    return `${context.value.item.itemKey} ${context.value.item.title}`
  }),
  bizUrl: computed(() => {
    if (!context.value) return ''
    return resolveCurrentAppUrl(`/projects/${context.value.item.projectId}/board/${context.value.item.id}/execution`)
  }),
  bizContext: computed(() => ({
    project_id: context.value?.item.projectId || projectId.value
  })),
  actions: computed(() => {
    const status = context.value?.item.status
    if (!status || !['in_progress', 'in_review', 'completed'].includes(status)) return []

    const actionIssues = computed(() => {
      const issues = [...completenessIssues.value]
      if (status === 'in_review') {
        return ['任务已提交审批，等待审批结果', ...issues]
      }
      if (status === 'completed') {
        return ['任务已完成，不允许重复提交', ...issues]
      }
      return issues
    })

    return [{
      actionCode: 'complete',
      actionName: '完成确认',
      canSubmit: computed(() => status === 'in_progress' && completenessIssues.value.length === 0),
      completenessIssues: actionIssues,
      async beforeSubmit() {
        const noteText = completionNote.value.trim()
        if (noteText && noteText !== savedCompletionNote.value) {
          await $fetch(`/api/v1/work-items/${workItemId.value}/comments`, {
            method: 'POST',
            body: { content: `完成说明：${noteText}` }
          })
          savedCompletionNote.value = noteText
        }
      },
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
    }]
  })
})

// ====== 提交确认（无流程时的直接提交） ======
async function handleSaveCompletionNote() {
  if (!context.value) return
  submittingReview.value = true
  try {
    const noteText = completionNote.value.trim()
    if (!noteText) {
      toast.add({ title: '完成说明为选填，当前无需保存', color: 'neutral' })
      return
    }
    if (noteText === savedCompletionNote.value) {
      toast.add({ title: '完成说明已是最新', color: 'neutral' })
      return
    }
    await $fetch(`/api/v1/work-items/${workItemId.value}/comments`, {
      method: 'POST',
      body: { content: `完成说明：${noteText}` }
    })
    savedCompletionNote.value = noteText
    toast.add({ title: '已保存完成说明', color: 'success', icon: 'i-lucide-save' })
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '保存失败'
    toast.add({ title: msg, color: 'error' })
  } finally {
    submittingReview.value = false
  }
}

onMounted(loadContext)
</script>

<template>
  <Teleport to="#aims-layout-header-actions">
    <UButton
      icon="i-lucide-arrow-left"
      label="返回看板"
      color="neutral"
      variant="ghost"
      size="sm"
      @click="navigateTo(`/projects/${projectId}/board`)"
    />
  </Teleport>

  <UDashboardPanel
    id="work-item-execution"
    :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 overflow-y-auto p-0' }"
  >
    <template #body>
      <ProjectNavbar />
      <div class="px-0 pt-0 pb-12 sm:pb-14">
        <div v-if="loading || !context" class="flex items-center justify-center py-20">
          <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-muted" />
        </div>

        <div v-else class="space-y-4 pt-0 pb-4">
          <!-- 项目暂停提示 -->
          <div v-if="workItemReadonlyReason" class="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning flex items-center gap-2">
            <UIcon name="i-lucide-pause-circle" class="size-4 shrink-0" />
            {{ workItemReadonlyReason }}
          </div>
          <!-- 任务信息卡片 -->
          <UCard class="overflow-hidden border-secondary/20 bg-linear-to-br from-success/10 via-success/10 to-transparent shadow-sm">
            <template #header>
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div class="flex w-full flex-wrap items-center gap-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <UBadge color="neutral" variant="subtle">
                      {{ context.item.itemKey }}
                    </UBadge>
                    <UBadge :color="(getStatusColor(context.item.status) as any)" variant="subtle">
                      {{ getStatusLabel(context.item.status) }}
                    </UBadge>
                    <UBadge :color="(currentPriorityBadge?.color as any) || 'neutral'" variant="soft">
                      {{ currentPriorityBadge?.label || context.item.priority }}
                    </UBadge>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <UIcon :name="typeConfig[context.item.type]?.icon || 'i-lucide-circle'" :class="['size-5', typeConfig[context.item.type]?.color || 'text-muted']" />
                  <h1 class="text-xl font-semibold">
                    {{ context.item.title }}
                  </h1>
                </div>
                <div v-if="context.item.parentItemKey" class="text-sm text-muted">
                  来源目标：{{ context.item.parentItemKey }} {{ context.item.parentTitle }}
                </div>
                <div v-if="context.item.decompositionSourceKey" class="text-sm text-muted flex items-center gap-1">
                  <UIcon name="i-lucide-paperclip" class="size-3.5" />
                  来自需求分解：{{ context.item.decompositionSourceKey }}
                </div>
                <UButton
                  v-if="context.item.templateKey === 'requirement_change' && context.item.status === 'completed'"
                  color="primary"
                  variant="soft"
                  icon="i-lucide-rotate-cw"
                  :loading="cloningChange"
                  @click="cloneRequirementChange"
                >
                  发起新一轮变更
                </UButton>
              </div>
            </template>

            <div class="grid gap-1 md:grid-cols-2 xl:grid-cols-4">
              <div class="rounded-2xl border border-default/70 bg-default/70 px-3 py-3">
                <div class="text-xs uppercase tracking-wide text-dimmed">
                  负责人
                </div>
                <div class="mt-2 text-sm font-medium">
                  {{ getUserName(context.item.assigneeUid) }}
                </div>
              </div>
              <div class="rounded-2xl border border-default/70 bg-default/70 px-3 py-3">
                <div class="text-xs uppercase tracking-wide text-dimmed">
                  截止日期
                </div>
                <div class="mt-2 text-sm font-medium">
                  {{ formatDate(context.item.dueDate) }}
                </div>
              </div>
              <div class="rounded-2xl border border-default/70 bg-default/70 px-3 py-3">
                <div class="text-xs uppercase tracking-wide text-dimmed">
                  已用 / 预估工时
                </div>
                <div class="mt-2 text-sm font-medium">
                  {{ formatHours(totalHours) }}h / {{ context.item.estimatedHours ? formatHours(context.item.estimatedHours) + 'h' : '-' }}
                </div>
              </div>
              <div class="rounded-2xl border border-default/70 bg-default/70 px-3 py-3">
                <div class="text-xs uppercase tracking-wide text-dimmed">
                  里程碑
                </div>
                <div class="mt-2 text-sm font-medium">
                  {{ context.item.milestoneName }}
                </div>
              </div>
            </div>

            <MarkdownContent
              v-if="context.item.description"
              :markdown="context.item.description"
              class="mt-4 text-sm bg-default/90 rounded-md p-3 max-h-60 overflow-y-auto"
            />

            <div class="mt-4">
              <WorkItemSourceSectionViewer :work-item-id="workItemId" />
            </div>
          </UCard>

          <!-- 工作成果 -->
          <UCard class="shadow-sm">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-clipboard-check" class="size-5 text-primary" />
                <span class="font-semibold">工作成果</span>
                <span class="text-sm text-muted">{{ context.deliverables.length }} 项</span>
              </div>
            </template>

            <div v-if="context.deliverables.length === 0" class="text-sm text-muted py-4 text-center">
              暂无交付物要求
            </div>
            <div v-else class="space-y-3">
              <div
                v-for="d in context.deliverables"
                :key="d.id"
                class="rounded-lg border border-default p-3 space-y-2"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <UIcon name="i-lucide-package" class="size-4 text-info shrink-0" />
                    <span class="font-medium text-sm truncate">{{ d.name }}</span>
                    <UBadge
                      v-if="d.required"
                      color="error"
                      variant="soft"
                      size="xs"
                    >
                      必须
                    </UBadge>
                  </div>
                  <!-- 文档类：选择/更换文档按钮，替代状态 badge -->
                  <UButton
                    v-if="d.deliverableType === 'document' && isWorkItemEditable && isAssignee && !workflowReadonly && !isApprovalMode && !isExecutionReadonly"
                    :label="d.documentUuid ? '更换文档' : '选择文档'"
                    :icon="d.documentUuid ? 'i-lucide-file-edit' : 'i-lucide-file-plus'"
                    size="xs"
                    color="primary"
                    variant="soft"
                    @click="openSubmitDocModal(d)"
                  />
                  <!-- 其它类型：显示状态 badge（代码类本就不需要 submitted 状态，不展示） -->
                  <UBadge
                    v-else-if="!['document', 'code'].includes(d.deliverableType)"
                    :color="(deliverableStatusColor[d.status] as any)"
                    variant="subtle"
                    size="xs"
                  >
                    {{ deliverableStatusLabel[d.status] || d.status }}
                  </UBadge>
                </div>

                <div v-if="d.acceptanceCriteria" class="text-xs text-muted">
                  验收标准：{{ d.acceptanceCriteria }}
                </div>

                <!-- 文档类：已关联的项目文档（点击预览） -->
                <button
                  v-if="d.deliverableType === 'document' && d.documentUuid"
                  type="button"
                  class="w-full flex items-center gap-3 px-3 py-2 rounded-md bg-elevated hover:bg-elevated/80 transition-colors text-left cursor-pointer"
                  @click="openDocPreview(d)"
                >
                  <UIcon name="i-lucide-file-text" class="size-5 text-primary shrink-0" />
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-medium truncate">
                      {{ d.documentTitle || d.name }}
                    </div>
                  </div>
                  <div class="text-xs text-muted">
                    点击查看
                  </div>
                </button>

                <!-- 代码类：关联代码提交 -->
                <div v-if="d.deliverableType === 'code'" class="border-t border-default pt-2 space-y-2">
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 flex-wrap text-xs">
                      <UIcon name="i-lucide-git-commit-horizontal" class="size-4 text-success" />
                      <span class="font-medium">关联代码提交</span>
                      <span class="text-muted">{{ context.commits.length }} 条</span>
                      <template v-if="commitStats">
                        <span v-if="commitStats.files" class="text-muted">{{ commitStats.files }} 文件</span>
                        <span class="text-success">+{{ commitStats.additions }}</span>
                        <span class="text-error">-{{ commitStats.deletions }}</span>
                      </template>
                    </div>
                    <UButton
                      v-if="isWorkItemEditable && isAssignee && !workflowReadonly && !isApprovalMode"
                      label="关联提交"
                      icon="i-lucide-plus"
                      size="xs"
                      color="primary"
                      variant="soft"
                      @click="openCommitModal"
                    />
                  </div>

                  <div v-if="context.commits.length === 0" class="text-xs text-muted py-2 text-center">
                    暂无关联的代码提交
                  </div>
                  <div v-else class="space-y-1.5">
                    <div
                      v-for="c in context.commits"
                      :key="c.id"
                      class="flex items-start gap-2 rounded-md border border-default px-2 py-1.5 hover:bg-elevated/50 cursor-pointer"
                      @click="openDiffModal(c)"
                    >
                      <UIcon name="i-lucide-git-commit-horizontal" class="size-3.5 text-muted shrink-0 mt-0.5" />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 text-[11px]">
                          <span class="font-mono text-primary text-xs">{{ c.commitSha.slice(0, 8) }}</span>
                          <span class="text-muted">{{ c.authorName }}</span>
                          <span v-if="c.filesChanged" class="text-muted">{{ c.filesChanged }} 文件</span>
                          <span v-if="c.additions != null" class="text-success">+{{ c.additions }}</span>
                          <span v-if="c.deletions != null" class="text-error">-{{ c.deletions }}</span>
                          <span class="flex-1" />
                          <span class="text-dimmed shrink-0">{{ formatDateTime(c.committedAt) }}</span>
                        </div>
                        <div class="text-xs text-muted mt-0.5 whitespace-pre-line line-clamp-2">
                          {{ c.message }}
                        </div>
                      </div>
                      <UButton
                        v-if="isWorkItemEditable && isAssignee && !workflowReadonly && !isApprovalMode"
                        icon="i-lucide-x"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        @click.stop="unlinkCommit(c.id)"
                      />
                    </div>
                  </div>
                </div>

                <!-- 已提交证据（非文档、非代码类） -->
                <div
                  v-if="!['document', 'code'].includes(d.deliverableType) && (d.evidenceUrl || d.evidenceNote)"
                  class="text-xs bg-elevated/50 rounded p-2 space-y-1"
                >
                  <div v-if="d.evidenceUrl" class="flex items-center gap-1">
                    <UIcon name="i-lucide-link" class="size-3" />
                    <a :href="d.evidenceUrl" target="_blank" class="text-primary hover:underline truncate">{{ d.evidenceUrl }}</a>
                  </div>
                  <div v-if="d.evidenceNote">
                    {{ d.evidenceNote }}
                  </div>
                </div>

                <!-- 编辑证据（非文档、非代码类） -->
                <div
                  v-if="!['document', 'code'].includes(d.deliverableType) && editingDeliverableId === d.id"
                  class="space-y-2 border-t border-default pt-2"
                >
                  <UInput v-model="evidenceForm.evidenceUrl" placeholder="证据链接（如 GitLab MR 地址）" size="sm" />
                  <UTextarea
                    v-model="evidenceForm.evidenceNote"
                    placeholder="证据说明"
                    :rows="2"
                    size="sm"
                  />
                  <div class="flex gap-2">
                    <UButton
                      label="保存"
                      size="xs"
                      color="primary"
                      @click="saveEvidence(d.id)"
                    />
                    <UButton
                      label="取消"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      @click="cancelEditEvidence"
                    />
                  </div>
                </div>

                <!-- 其它类型：填写证据 + 提交成果（文档按钮已在头部，代码靠关联提交即可） -->
                <div
                  v-if="isWorkItemEditable && isAssignee && !workflowReadonly && !isApprovalMode && !['document', 'code'].includes(d.deliverableType) && d.status === 'pending' && editingDeliverableId !== d.id"
                  class="flex gap-2"
                >
                  <UButton
                    label="填写证据"
                    icon="i-lucide-pencil"
                    size="xs"
                    color="neutral"
                    variant="soft"
                    @click="startEditEvidence(d)"
                  />
                  <UButton
                    label="提交成果"
                    icon="i-lucide-send"
                    size="xs"
                    color="primary"
                    variant="soft"
                    :disabled="!d.evidenceUrl && !d.evidenceNote"
                    @click="submitGenericDeliverable(d.id)"
                  />
                </div>
              </div>
            </div>
          </UCard>

          <!-- 工时记录 -->
          <UCard class="shadow-sm">
            <template #header>
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-clock" class="size-5 text-warning" />
                  <span class="font-semibold">工时记录</span>
                  <span class="text-sm text-muted">{{ formatHours(totalHours) }}h</span>
                </div>
                <UButton
                  v-if="isAssignee && !workflowReadonly && !isApprovalMode && !isExecutionReadonly"
                  :label="showTimeForm ? '收起' : '记录工时'"
                  :icon="showTimeForm ? 'i-lucide-chevron-up' : 'i-lucide-plus'"
                  size="xs"
                  color="primary"
                  variant="soft"
                  @click="toggleTimeForm"
                />
              </div>
            </template>

            <div v-if="context.timeEntries.length === 0 && !showTimeForm" class="text-sm text-muted py-4 text-center">
              暂无工时记录
            </div>
            <div v-else-if="context.timeEntries.length > 0" class="space-y-1">
              <div
                v-for="entry in context.timeEntries"
                :key="entry.id"
                class="group flex items-center gap-6 rounded px-2 py-1.5 text-sm transition-colors"
                :class="[
                  editingTimeEntryId === entry.id ? 'bg-primary-50 dark:bg-primary-950/40 ring-1 ring-primary' : 'hover:bg-elevated/50',
                  (entry.uid === currentUserUid && isAssignee && !workflowReadonly && !isApprovalMode && !isExecutionReadonly) ? 'cursor-pointer' : ''
                ]"
                @click="entry.uid === currentUserUid && !isExecutionReadonly ? startEditTimeEntry(entry) : null"
              >
                <span class="text-xs text-muted w-20 shrink-0">{{ entry.entryDate.slice(0, 10) }}</span>
                <span class="font-medium w-12 shrink-0">{{ formatHours(entry.hours) }}h</span>
                <span class="text-xs text-muted truncate flex-1">{{ entry.description || '-' }}</span>
                <span class="text-xs text-dimmed shrink-0">{{ getUserName(entry.uid) }}</span>
                <UButton
                  v-if="entry.uid === currentUserUid && isAssignee && !workflowReadonly && !isApprovalMode && !isExecutionReadonly"
                  icon="i-lucide-trash-2"
                  size="xs"
                  color="error"
                  variant="ghost"
                  class="opacity-0 group-hover:opacity-100"
                  @click.stop="deleteTimeEntry(entry.id)"
                />
              </div>
            </div>

            <!-- 工时录入/编辑表单（放在列表下方） -->
            <div v-if="showTimeForm && !isExecutionReadonly" class="mt-4 rounded-lg border border-default p-3 space-y-3">
              <div class="text-xs text-muted">
                {{ editingTimeEntryId ? '编辑工时记录' : '新增工时记录' }}
              </div>
              <div class="grid gap-3 md:grid-cols-10">
                <UFormField label="日期" required class="md:col-span-3">
                  <UInput
                    v-model="timeForm.entryDate"
                    type="date"
                    size="sm"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="工时" required class="md:col-span-2">
                  <UInput
                    v-model="timeForm.hours"
                    type="number"
                    min="0.5"
                    max="24"
                    step="0.5"
                    size="sm"
                    class="w-full"
                    placeholder="如 2"
                  />
                </UFormField>
                <UFormField label="工作说明" class="md:col-span-5">
                  <UInput
                    v-model="timeForm.description"
                    size="sm"
                    class="w-full"
                    placeholder="简要描述工作内容"
                  />
                </UFormField>
              </div>
              <div v-if="timeEntryDateWarning" class="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
                {{ timeEntryDateWarning }}，允许继续记录工时。
              </div>
              <div class="flex justify-end gap-4">
                <UButton
                  label="取消"
                  icon="i-lucide-x"
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  @click="cancelTimeEdit"
                />
                <UButton
                  :label="editingTimeEntryId ? '保存' : '记录'"
                  icon="i-lucide-check"
                  size="sm"
                  color="primary"
                  :loading="savingTime"
                  @click="saveTimeEntry"
                />
              </div>
            </div>
          </UCard>

          <!-- 完成说明（仅保存；正式提交由右侧流程面板的"提交审批"触发） -->
          <UCard v-if="isWorkItemEditable && isAssignee && !workflowReadonly && !isApprovalMode && context.item.status === 'in_progress'" class="shadow-sm">
            <template #header>
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-notebook-pen" class="size-5 text-primary" />
                  <span class="font-semibold">完成说明</span>
                </div>
                <UButton
                  label="保存"
                  icon="i-lucide-save"
                  variant="soft"
                  size="sm"
                  color="primary"
                  :loading="submittingReview"
                  :disabled="!canSaveCompletionNote"
                  @click="handleSaveCompletionNote"
                />
              </div>
            </template>

            <div class="space-y-4">
              <UFormField label="完成说明（选填）">
                <UTextarea
                  v-model="completionNote"
                  :rows="3"
                  placeholder="简要描述完成情况、遇到的问题、需要关注的事项等。保存后将写入工作评论；提交审批请使用右侧流程面板。"
                  class="w-full"
                />
              </UFormField>
            </div>
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <!-- 关联提交弹窗 -->
  <UModal v-model:open="showCommitModal" :ui="{ content: 'sm:max-w-4xl' }">
    <template #header>
      <div class="flex items-center justify-between w-full">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-git-commit-horizontal" class="size-5 text-primary" />
          <span class="font-semibold">关联代码提交</span>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            label="同步 GitLab"
            icon="i-lucide-refresh-cw"
            size="xs"
            color="neutral"
            variant="soft"
            :loading="syncingGitlab"
            @click="syncGitlab"
          />
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            @click="showCommitModal = false"
          />
        </div>
      </div>
    </template>
    <template #body>
      <div class="space-y-3">
        <UInput
          v-model="commitSearchKeyword"
          icon="i-lucide-search"
          placeholder="搜索提交信息、SHA 或作者"
          size="sm"
          @update:model-value="searchCommits"
        />
        <div v-if="loadingCommits" class="flex items-center justify-center py-8">
          <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
        </div>
        <div v-else-if="availableCommits.length === 0" class="text-sm text-muted text-center py-8">
          没有可关联的提交，请先点击「同步 GitLab」拉取最新提交
        </div>
        <div v-else class="max-h-[60vh] overflow-y-auto space-y-1">
          <div
            v-for="c in availableCommits"
            :key="c.id"
            class="rounded-lg border border-default overflow-hidden"
          >
            <div
              class="flex items-start gap-3 px-3 py-2 hover:bg-elevated/50 cursor-pointer"
              @click="toggleDiff(c.id)"
            >
              <UIcon
                name="i-lucide-chevron-right"
                class="size-4 text-dimmed shrink-0 mt-0.5 transition-transform"
                :class="expandedCommitId === c.id ? 'rotate-90' : ''"
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 text-xs">
                  <span class="font-mono text-primary text-sm">{{ c.commitSha.slice(0, 8) }}</span>
                  <span class="text-muted">{{ c.authorName }}</span>
                  <span class="text-muted">{{ c.repoProjectCode }}</span>
                  <span class="flex-1" />
                  <span class="text-dimmed shrink-0">{{ formatDateTime(c.committedAt) }}</span>
                </div>
                <div class="text-sm text-muted truncate mt-0.5">
                  {{ c.message }}
                </div>
              </div>
              <UButton
                icon="i-lucide-plus"
                color="primary"
                variant="ghost"
                size="xs"
                square
                @click.stop="linkCommit(c.id)"
              />
            </div>

            <!-- Diff 展开区域 -->
            <div v-if="expandedCommitId === c.id" class="border-t border-default bg-elevated/30">
              <div v-if="loadingDiff" class="flex items-center justify-center py-6">
                <UIcon name="i-lucide-loader-2" class="size-4 animate-spin text-muted" />
              </div>
              <div v-else-if="diffData.length === 0" class="text-xs text-muted text-center py-4">
                无 diff 数据
              </div>
              <div v-else class="divide-y divide-default">
                <div v-for="(file, fi) in diffData" :key="fi" class="text-xs">
                  <div class="flex items-center gap-2 px-3 py-1.5 bg-elevated/50 font-mono">
                    <UIcon
                      :name="file.newFile ? 'i-lucide-file-plus' : file.deletedFile ? 'i-lucide-file-minus' : 'i-lucide-file-diff'"
                      :class="file.newFile ? 'text-success' : file.deletedFile ? 'text-error' : 'text-warning'"
                      class="size-3.5 shrink-0"
                    />
                    <span class="truncate">{{ file.newPath }}</span>
                    <span v-if="file.renamedFile" class="text-dimmed">&larr; {{ file.oldPath }}</span>
                  </div>
                  <pre class="px-3 py-2 overflow-x-auto text-[11px] leading-4 whitespace-pre font-mono max-h-60 overflow-y-auto"><template
                    v-for="(line, li) in file.diff.split('\n')"
                    :key="li"
                  ><span
                    :class="{
                      'text-success bg-success/10': line.startsWith('+') && !line.startsWith('+++'),
                      'text-error bg-error/10': line.startsWith('-') && !line.startsWith('---'),
                      'text-info': line.startsWith('@@')
                    }"
                  >{{ line }}
</span></template></pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UModal>

  <!-- Diff 弹窗 -->
  <UModal v-model:open="showDiffModal" :ui="{ content: 'sm:max-w-5xl max-h-[90vh]' }">
    <template #header>
      <div class="flex items-center justify-between w-full">
        <div v-if="diffCommitInfo" class="flex-1 min-w-0">
          <div class="flex items-center gap-2 text-xs">
            <span class="font-mono text-primary text-sm">{{ diffCommitInfo.commitSha.slice(0, 8) }}</span>
            <span class="text-muted">{{ diffCommitInfo.authorName }}</span>
            <span v-if="diffData.length" class="text-muted">{{ diffData.length }} 文件</span>
            <span v-if="diffCommitInfo.additions != null" class="text-success">+{{ diffCommitInfo.additions }}</span>
            <span v-if="diffCommitInfo.deletions != null" class="text-error">-{{ diffCommitInfo.deletions }}</span>
            <span class="flex-1" />
            <span class="text-dimmed">{{ formatDateTime(diffCommitInfo.committedAt) }}</span>
          </div>
          <div class="text-sm truncate mt-0.5">
            {{ diffCommitInfo.message }}
          </div>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          square
          class="ml-2 shrink-0"
          @click="showDiffModal = false"
        />
      </div>
    </template>
    <template #body>
      <div v-if="loadingDiff" class="flex items-center justify-center py-12">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
      </div>
      <div v-else-if="diffData.length === 0" class="text-sm text-muted text-center py-12">
        无 diff 数据
      </div>
      <div v-else class="divide-y divide-default">
        <div v-for="(file, fi) in diffData" :key="fi" class="text-xs">
          <div class="flex items-center gap-2 px-3 py-1.5 bg-elevated/50 font-mono sticky top-0 z-10">
            <UIcon
              :name="file.newFile ? 'i-lucide-file-plus' : file.deletedFile ? 'i-lucide-file-minus' : 'i-lucide-file-diff'"
              :class="file.newFile ? 'text-success' : file.deletedFile ? 'text-error' : 'text-warning'"
              class="size-3.5 shrink-0"
            />
            <span class="truncate">{{ file.newPath }}</span>
            <span v-if="file.renamedFile" class="text-dimmed">&larr; {{ file.oldPath }}</span>
          </div>
          <pre class="px-3 py-2 overflow-x-auto text-[11px] leading-4 whitespace-pre font-mono"><template
            v-for="(line, li) in file.diff.split('\n')"
            :key="li"
          ><span
            :class="{
              'text-success bg-success/10': line.startsWith('+') && !line.startsWith('+++'),
              'text-error bg-error/10': line.startsWith('-') && !line.startsWith('---'),
              'text-info': line.startsWith('@@')
            }"
          >{{ line }}
</span></template></pre>
        </div>
      </div>
    </template>
  </UModal>

  <!-- 绑定成果文档：统一 AimsDocumentPicker（部门 / 项目组 / 项目仓库 三种来源） -->
  <AimsDocumentPicker
    v-model:open="showSubmitDocModal"
    :title="`选择成果文档 - ${submittingDeliverableName}`"
    :dept-code="projectStore.currentProject?.deptCode || null"
    :aims-project-id="context?.item.projectId ?? null"
    :repos="projectStore.currentProject?.repos || []"
    :initial-value="submittingInitialDocRef"
    default-source="repo"
    mode="snapshot"
    @select="handleDeliverableDocSelected"
  />

  <!-- 已关联文档预览（codocs 走 iframe；repo 走 markdown） -->
  <UModal v-model:open="showDocPreviewModal" :ui="{ content: 'sm:max-w-6xl', body: 'overflow-hidden p-0' }">
    <template #header>
      <span class="text-base font-medium">{{ previewDocTitle || '文档预览' }}</span>
    </template>
    <template #body>
      <div class="h-[70vh] rounded-lg border border-default bg-elevated/40 p-4 min-h-48">
        <AimsDocumentPreview
          v-if="previewDocRef && showDocPreviewModal"
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
          @click="showDocPreviewModal = false"
        />
      </div>
    </template>
  </UModal>
</template>
