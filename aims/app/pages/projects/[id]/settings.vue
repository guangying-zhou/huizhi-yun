<script setup lang="ts">
import { projectStatusConfig, projectCategoryConfig, methodologyConfig, projectSecurityLevelConfig, projectSecurityLevelOptions } from '~/config/project'
import { projectWorkflowActionConfigs } from '~/utils/projectWorkflow'
import type { ProjectWorkflowActionCode } from '~/utils/projectWorkflow'
import type { LifecycleStatus, ProjectSecurityLevel } from '~/types/aims'
import { PROJECT_ROLE_COLORS, PROJECT_ROLE_LABELS, PROJECT_ROLE_OPTIONS } from '~/utils/projectRoles'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '设置',
  layoutHeaderProjectSwitcher: true
})

const route = useRoute()
const { resolveCurrentAppUrl } = useAppUrls()
const projectId = computed(() => Number(route.params.id))

const projectStore = useProjectStore()
const portfolioStore = usePortfolioStore()
const milestoneStore = useMilestoneStore()
const { users: accountUsers } = useAccountUsers()
const { domains: businessDomains } = useBusinessDomains()

const { isApprovalMode } = useApprovalMode()
const showDeleteConfirm = ref(false)
const showEditModal = ref(false)
const showSecurityModal = ref(false)
const securitySaving = ref(false)
const showAddMemberModal = ref(false)
const addingMember = ref(false)
const newMemberUid = ref('')
const newMemberRole = ref<'manager' | 'member' | 'viewer'>('member')
const showRemoveMemberConfirm = ref(false)
const showSuspendMemberConfirm = ref(false)
const operatingMember = ref<{ uid: string, name: string, workItemCount: number } | null>(null)
const removingMember = ref(false)
const securityForm = ref<{
  securityLevel: ProjectSecurityLevel
  accessWhitelist: string[]
}>({
  securityLevel: 'company',
  accessWhitelist: []
})

// 新仓库关联
const showAddRepoModal = ref(false)
const newRepoCode = ref('')
const addingRepo = ref(false)

// 仓库弹窗：群组下的仓库列表
const groupRepos = ref<{ projectCode: string, name: string, repoUrl: string | null }[]>([])
const groupReposLoading = ref(false)

// 创建新仓库
const showCreateRepoForm = ref(false)
const newRepoName = ref('')
const creatingRepo = ref(false)
const createdRepoUrl = ref('')

interface ProjectProductBinding {
  id: number
  product_code: string
  product_name: string | null
  version_code?: string | null
  is_primary: number
}

const productBindings = ref<ProjectProductBinding[]>([])

async function loadProductBindings() {
  try {
    const res = await $fetch<{ code: number, data: { items: ProjectProductBinding[] } }>(
      `/api/v1/projects/${projectId.value}/products`
    )
    productBindings.value = res.data.items || []
  } catch {
    productBindings.value = []
  }
}

// 立项书
// import type { DocumentRef } from '~/composables/useAimsDocumentPicker'

interface ProposalInfo {
  id: number
  uuid: string
  title: string
  codocsUuid: string | null
  documentSource: 'codocs' | 'repo'
  repoProjectCode: string | null
  repoFilePath: string | null
  repoCommitId: string | null
  createdBy: string
  createdAt: string
}

const proposal = ref<ProposalInfo | null>(null)
const showProposalPreviewModal = ref(false)
const showProposalChangeModal = ref(false)
const proposalSaving = ref(false)

async function loadProposal() {
  try {
    const res = await $fetch<{ code: number, data: { proposal: ProposalInfo | null } }>(
      `/api/v1/projects/${projectId.value}/documents`
    )
    if (res.code === 0) {
      proposal.value = res.data.proposal
    }
  } catch {
    // silent
  }
}

function openProposalChangeModal() {
  showProposalChangeModal.value = true
}

const proposalInitialValue = computed<DocumentRef | null>(() => {
  const p = proposal.value
  if (!p) return null
  return p.documentSource === 'repo'
    ? {
        source: 'repo',
        title: p.title,
        repoProjectCode: p.repoProjectCode,
        repoFilePath: p.repoFilePath,
        repoCommitId: p.repoCommitId
      }
    : {
        source: 'codocs',
        title: p.title,
        codocsUuid: p.codocsUuid
      }
})

async function handleProposalSelected(docRef: DocumentRef) {
  proposalSaving.value = true
  try {
    await $fetch(`/api/v1/projects/${projectId.value}/documents`, {
      method: proposal.value ? 'PUT' : 'POST',
      body: {
        source: docRef.source,
        title: docRef.title,
        codocsUuid: docRef.codocsUuid,
        repoProjectCode: docRef.repoProjectCode,
        repoFilePath: docRef.repoFilePath,
        repoCommitId: docRef.repoCommitId
      }
    })
    await loadProposal()
    toast.add({ title: '立项书已变更', color: 'success' })
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '变更立项书失败'
    toast.add({ title: msg, color: 'error' })
  } finally {
    proposalSaving.value = false
  }
}

onMounted(async () => {
  if (!projectStore.currentProject || projectStore.currentProject.id !== projectId.value) {
    await projectStore.fetchProject(projectId.value)
  }
  await Promise.all([
    projectStore.fetchMembers(projectId.value),
    projectStore.fetchRepos(projectId.value),
    portfolioStore.fetchPortfolios(),
    milestoneStore.fetchMilestones(projectId.value),
    loadProductBindings(),
    loadProposal()
  ])
})

const milestones = computed(() => milestoneStore.milestones)
const pivrStageLabel: Record<string, string> = { P: '规划 P', I: '实施 I', V: '验证 V', R: '发布 R' }
function fmtDate(d: string | null | undefined): string {
  if (!d) return '-'
  return String(d).slice(0, 10)
}

function parseDateValue(dateText: string | null | undefined): number | null {
  if (!dateText) return null
  const normalized = String(dateText).slice(0, 10)
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  const timestamp = parsed.getTime()
  if (
    Number.isNaN(timestamp)
    || parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null
  }
  return timestamp
}

function summarizeNames(names: string[], limit = 3): string {
  const sample = names.slice(0, limit).join('、')
  if (names.length <= limit) return sample
  return `${sample} 等 ${names.length} 项`
}

interface ComparableMilestoneRange {
  name: string
  startDate: string
  endDate: string
  startValue: number
  endValue: number
}

function buildComparableMilestoneRanges() {
  const missingDateMilestones: string[] = []
  const invalidDateMilestones: string[] = []
  const invalidRangeMilestones: string[] = []
  const comparableRanges: ComparableMilestoneRange[] = []

  for (const milestone of milestones.value) {
    if (!milestone.startDate || !milestone.endDate) {
      missingDateMilestones.push(milestone.name)
      continue
    }

    const startValue = parseDateValue(milestone.startDate)
    const endValue = parseDateValue(milestone.endDate)
    if (startValue == null || endValue == null) {
      invalidDateMilestones.push(milestone.name)
      continue
    }
    if (startValue > endValue) {
      invalidRangeMilestones.push(milestone.name)
      continue
    }

    comparableRanges.push({
      name: milestone.name,
      startDate: milestone.startDate,
      endDate: milestone.endDate,
      startValue,
      endValue
    })
  }

  return {
    missingDateMilestones,
    invalidDateMilestones,
    invalidRangeMilestones,
    comparableRanges
  }
}

function findOverlappingMilestonePairs(ranges: ComparableMilestoneRange[]): string[] {
  const sortedRanges = [...ranges].sort((left, right) => {
    if (left.startValue !== right.startValue) return left.startValue - right.startValue
    if (left.endValue !== right.endValue) return left.endValue - right.endValue
    return left.name.localeCompare(right.name, 'zh-CN')
  })

  const overlaps: string[] = []
  for (let index = 0; index < sortedRanges.length; index++) {
    const current = sortedRanges[index]
    if (!current) continue
    for (let nextIndex = index + 1; nextIndex < sortedRanges.length; nextIndex++) {
      const next = sortedRanges[nextIndex]
      if (!next) continue
      if (next.startValue >= current.endValue) break
      overlaps.push(`${current.name}（${fmtDate(current.startDate)} ~ ${fmtDate(current.endDate)}）与 ${next.name}（${fmtDate(next.startDate)} ~ ${fmtDate(next.endDate)}）`)
    }
  }

  return overlaps
}

const project = computed(() => projectStore.currentProject)
const isDraft = computed(() => project.value?.lifecycleStatus === 'draft')
const repos = computed(() => projectStore.currentProject?.repos || [])
const toast = useToast()
const currentUserRole = computed(() => project.value?.currentUserRole)
const canManageMembers = computed(() => currentUserRole.value === 'manager')
const canManageProducts = computed(() => {
  return currentUserRole.value === 'manager'
    && ['product_dev', 'delivery', 'maintenance'].includes(project.value?.category || '')
})

const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const user of accountUsers.value) {
    if (user.realName?.trim()) map.set(user.uid, user.realName.trim())
  }
  return map
})

const members = computed(() => {
  const raw = project.value?.members || []
  return raw.map(member => ({
    ...member,
    realName: member.realName || userNameMap.value.get(member.uid) || ''
  }))
})

const memberColumns = [
  { accessorKey: 'realName', header: '姓名' },
  { accessorKey: 'role', header: '角色' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'joinedAt', header: '加入时间' },
  { accessorKey: 'actions', header: '操作' }
]

const userOptions = computed(() => {
  const seen = new Set<string>()
  return accountUsers.value
    .filter((user) => {
      if (seen.has(user.uid)) return false
      seen.add(user.uid)
      return true
    })
    .map(user => ({
      label: user.realName?.trim() ? `${user.realName.trim()}(${user.uid})` : user.uid,
      value: user.uid
    }))
})

// 当前项目所在项目集的 gitGroup
const portfolioGitGroup = computed(() => {
  const id = project.value?.portfolioId
  if (id == null) return null
  const pf = portfolioStore.portfolios.find(p => p.id === id)
  return pf?.gitGroup || null
})

// 仓库 repoUrl 映射：通过群组详情的 subProjects 批量获取
const repoUrlMap = ref<Map<string, string>>(new Map())

interface ProjectItem {
  projectCode: string
  repoUrl?: string
  subProjects?: ProjectItem[]
}

interface ProjectsResponse {
  code: number
  data: {
    items?: ProjectItem[]
  }
}

async function fetchRepoUrls() {
  if (repos.value.length === 0) return
  const gitGroup = portfolioGitGroup.value
  if (!gitGroup) return
  try {
    const res = await $fetch<ProjectsResponse>('/api/account/projects', {
      params: { only_group: 'false' }
    })
    if (res.code === 0 && res.data?.items) {
      const flatten = (items: ProjectItem[]): void => {
        for (const item of items) {
          if (item.repoUrl && item.projectCode) {
            repoUrlMap.value.set(item.projectCode, item.repoUrl)
          }
          if (item.subProjects?.length) {
            flatten(item.subProjects)
          }
        }
      }
      flatten(res.data.items)
    }
  } catch {
    // 忽略获取失败
  }
}

watch(() => [repos.value, portfolioGitGroup.value] as const, ([r, g]) => {
  if (r.length > 0 && g) fetchRepoUrls()
}, { immediate: true })

// 显示用的解析函数
const leaderName = computed(() => {
  const uid = project.value?.leaderUid
  if (!uid) return '-'
  const user = accountUsers.value.find(u => u.uid === uid)
  return user?.realName?.trim() || uid
})

function getUserName(uid: string | null | undefined) {
  if (!uid) return '-'
  const user = accountUsers.value.find(item => item.uid === uid)
  return user?.realName?.trim() || uid
}

const portfolioName = computed(() => {
  const id = project.value?.portfolioId
  if (id == null) return '-'
  const pf = portfolioStore.portfolios.find(p => p.id === id)
  return pf?.name || '-'
})

const domainName = computed(() => {
  const code = project.value?.domainCode
  if (!code) return '-'
  const domain = businessDomains.value.find(d => d.domainCode === code)
  return domain?.domainName || code
})

const categoryLabel = computed(() => {
  const cat = project.value?.category
  if (!cat) return '-'
  return projectCategoryConfig[cat]?.label || cat
})

const methodologyLabel = computed(() => {
  const m = project.value?.methodology
  if (!m) return '-'
  return methodologyConfig[m]?.label || m
})

const securityLevelConfig = computed(() => {
  const level = project.value?.securityLevel || 'company'
  return projectSecurityLevelConfig[level]
})

const accessWhitelistLabel = computed(() => {
  const uids = project.value?.accessWhitelist || []
  if (uids.length === 0) return '-'
  return uids.map(uid => getUserName(uid)).join('、')
})

const selectedSecurityFormConfig = computed(() => projectSecurityLevelConfig[securityForm.value.securityLevel])

const securityAccessWhitelist = computed({
  get: () => securityForm.value.accessWhitelist,
  set: (value: string[]) => {
    securityForm.value.accessWhitelist = value
  }
})

// ========================
// 平台审批流程（usePageWorkflow 多动作模式）
// ========================

function buildWorkflowAction(
  actionCode: ProjectWorkflowActionCode,
  overrides?: { canSubmit?: Ref<boolean> | ComputedRef<boolean>, completenessIssues?: Ref<string[]> | ComputedRef<string[]> }
) {
  const config = projectWorkflowActionConfigs[actionCode]
  return {
    actionCode,
    actionName: config.name,
    icon: actionCode === 'initiation'
      ? 'i-lucide-rocket'
      : actionCode === 'pause'
        ? 'i-lucide-pause'
        : actionCode === 'resume'
          ? 'i-lucide-play'
          : 'i-lucide-check-circle',
    canSubmit: overrides?.canSubmit ?? computed(() => !!project.value),
    completenessIssues: overrides?.completenessIssues ?? computed(() => [] as string[]),
    async onSubmitted() {
      // 提交后更新为过渡状态
      const statusOnSubmit: Partial<Record<ProjectWorkflowActionCode, LifecycleStatus>> = {
        initiation: 'approval_pending'
      }
      const newStatus = statusOnSubmit[actionCode]
      if (newStatus) {
        await projectStore.updateProject(projectId.value, { lifecycleStatus: newStatus })
      }
      toast.add({ title: `${config.successLabel}已发起`, color: 'success' })
      await projectStore.fetchProject(projectId.value)
    },
    async onApproved() {
      // 审批通过后变更项目状态
      const statusOnApproved: Record<ProjectWorkflowActionCode, LifecycleStatus> = {
        initiation: 'active',
        pause: 'paused',
        resume: 'active',
        finish: 'archived'
      }
      await projectStore.updateProject(projectId.value, { lifecycleStatus: statusOnApproved[actionCode] })
      toast.add({ title: `${config.name}已通过`, color: 'success' })
      await projectStore.fetchProject(projectId.value)
    },
    async onRejected() {
      // 驳回后回退状态（立项驳回回到 draft）
      if (actionCode === 'initiation') {
        await projectStore.updateProject(projectId.value, { lifecycleStatus: 'draft' })
      }
      toast.add({ title: `${config.name}已驳回`, color: 'warning' })
      await projectStore.fetchProject(projectId.value)
    }
  }
}

// 立项审批：需要关联立项书，并校验里程碑日期完整性、范围合法性与是否落在项目周期内
const initiationIssues = computed(() => {
  const issues: string[] = []
  if (!proposal.value) issues.push('未关联项目立项书')
  if (milestones.value.length === 0) {
    issues.push('尚未创建任何里程碑')
  } else {
    const {
      missingDateMilestones,
      invalidDateMilestones,
      invalidRangeMilestones,
      comparableRanges
    } = buildComparableMilestoneRanges()

    if (missingDateMilestones.length > 0) {
      issues.push(`${missingDateMilestones.length} 个里程碑未设置起止日期（${summarizeNames(missingDateMilestones)}），请前往里程碑页面设置`)
    }

    if (invalidDateMilestones.length > 0) {
      issues.push(`${invalidDateMilestones.length} 个里程碑日期格式无效（${summarizeNames(invalidDateMilestones)}），请检查后重试`)
    }

    if (invalidRangeMilestones.length > 0) {
      issues.push(`${invalidRangeMilestones.length} 个里程碑开始时间晚于结束时间（${summarizeNames(invalidRangeMilestones)}）`)
    }

    const projectStartValue = parseDateValue(project.value?.startDate)
    const projectEndValue = parseDateValue(project.value?.endDate)
    if (project.value && (projectStartValue == null || projectEndValue == null)) {
      issues.push('项目未设置有效的起止日期，无法校验里程碑是否落在项目周期内')
    } else if (projectStartValue != null && projectEndValue != null) {
      if (projectStartValue > projectEndValue) {
        issues.push('项目开始日期晚于结束日期，请先修正项目周期')
      } else {
        const outOfBoundsMilestones = comparableRanges
          .filter(range => range.startValue < projectStartValue || range.endValue > projectEndValue)
          .map(range => `${range.name}（${fmtDate(range.startDate)} ~ ${fmtDate(range.endDate)}）`)
        if (outOfBoundsMilestones.length > 0) {
          issues.push(`${outOfBoundsMilestones.length} 个里程碑超出项目周期 ${fmtDate(project.value?.startDate)} ~ ${fmtDate(project.value?.endDate)}（${summarizeNames(outOfBoundsMilestones)}）`)
        }
      }
    }

    const overlapPairs = findOverlappingMilestonePairs(comparableRanges)
    if (overlapPairs.length > 0) {
      issues.push(`${overlapPairs.length} 组里程碑时间范围存在重合（${summarizeNames(overlapPairs)}）`)
    }
  }
  return issues
})

const workflowActions = computed(() => {
  const status = project.value?.lifecycleStatus
  if (!status) return []
  switch (status) {
    case 'draft':
    case 'approval_pending':
      return [buildWorkflowAction('initiation', {
        completenessIssues: initiationIssues,
        canSubmit: computed(() => !!project.value && initiationIssues.value.length === 0)
      })]
    case 'active':
      return [
        buildWorkflowAction('pause'),
        buildWorkflowAction('finish')
      ]
    case 'paused':
      return [buildWorkflowAction('resume')]
    default:
      return []
  }
})

const { isReadonly: isWorkflowReadonly } = usePageWorkflow({
  appCode: 'aims',
  resourceCode: 'projects',
  bizId: computed(() => project.value ? String(project.value.id) : ''),
  bizTitle: computed(() => {
    const p = project.value
    return p ? (p.shortName || p.name) : ''
  }),
  bizUrl: computed(() => {
    if (!project.value) return ''
    return resolveCurrentAppUrl(`/projects/${project.value.id}/settings`)
  }),
  actions: workflowActions
})

function getErrorMessage(err: unknown, fallback = '操作失败') {
  if (!err || typeof err !== 'object') return fallback
  const objectError = err as { data?: unknown, message?: unknown, statusMessage?: unknown }
  const data = objectError.data
  if (data && typeof data === 'object') {
    const dataMsg = (data as { message?: unknown }).message
    if (typeof dataMsg === 'string' && dataMsg) return dataMsg
  }
  if (typeof objectError.message === 'string' && objectError.message) return objectError.message
  if (typeof objectError.statusMessage === 'string' && objectError.statusMessage) return objectError.statusMessage
  return fallback
}

async function handleDelete() {
  try {
    await projectStore.deleteProject(projectId.value)
    showDeleteConfirm.value = false
    await navigateTo('/projects')
  } catch (err) {
    toast.add({
      title: getErrorMessage(err, '删除失败'),
      color: 'error',
      icon: 'i-lucide-circle-x'
    })
  }
}

const groupRepoOptions = computed(() => {
  // 过滤掉群组本身（is_group）和已关联的仓库
  const linkedCodes = new Set(repos.value.map(r => r.repoProjectCode))
  return groupRepos.value
    .filter(r => !linkedCodes.has(r.projectCode))
    .map(r => ({
      label: `${r.name} (${r.projectCode})`,
      value: r.projectCode
    }))
})

interface GroupRepoItem {
  projectCode: string
  name: string
  repoUrl: string | null
  isGroup?: boolean
  subProjects?: GroupRepoItem[]
}

interface GroupReposResponse {
  code: number
  data: {
    items?: GroupRepoItem[]
  }
}

async function fetchGroupRepos() {
  const gitGroup = portfolioGitGroup.value
  if (!gitGroup) return
  groupReposLoading.value = true
  try {
    const res = await $fetch<GroupReposResponse>('/api/account/projects', {
      params: { parent_id: gitGroup, include_template: 'false' }
    })
    if (res.code === 0 && res.data?.items) {
      const flatten = (items: GroupRepoItem[]): GroupRepoItem[] => {
        const result: GroupRepoItem[] = []
        for (const item of items) {
          result.push(item)
          if (item.subProjects?.length) {
            result.push(...flatten(item.subProjects))
          }
        }
        return result
      }
      groupRepos.value = flatten(res.data.items)
        .filter((p: GroupRepoItem) => !p.isGroup)
        .map((p: GroupRepoItem) => ({
          projectCode: p.projectCode,
          name: p.name,
          repoUrl: p.repoUrl
        }))
    }
  } catch (err) {
    console.error('[Settings] Failed to fetch group repos:', err)
  } finally {
    groupReposLoading.value = false
  }
}

function openAddRepoModal() {
  newRepoCode.value = ''
  showCreateRepoForm.value = false
  createdRepoUrl.value = ''
  newRepoName.value = ''
  if (portfolioGitGroup.value) {
    fetchGroupRepos()
  }
  showAddRepoModal.value = true
}

async function handleCreateRepo() {
  const gitGroup = portfolioGitGroup.value
  if (!gitGroup || !newRepoName.value.trim()) return
  creatingRepo.value = true
  createdRepoUrl.value = ''
  try {
    const repoCode = newRepoName.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const fullProjectCode = `${gitGroup}/${repoCode}`
    const res = await $fetch<{ success: boolean, data: { repoUrl?: string } }>('/api/account/projects', {
      method: 'POST',
      body: {
        projectCode: fullProjectCode,
        name: newRepoName.value.trim(),
        deptCode: project.value?.deptCode || '',
        leaderUid: project.value?.leaderUid || '',
        description: project.value?.name || '',
        parentId: gitGroup,
        createOnGitlab: true
      }
    })
    if (res.success) {
      // 直接使用返回的 repoUrl
      if (res.data?.repoUrl) {
        createdRepoUrl.value = res.data.repoUrl
      }
      // 刷新仓库列表
      await fetchGroupRepos()
      // 自动选中新创建的仓库
      newRepoCode.value = fullProjectCode
      showCreateRepoForm.value = false
      newRepoName.value = ''
    }
  } catch (err: unknown) {
    console.error('[Settings] Failed to create repo:', err)
    const errorMessage = getErrorMessage(err, '创建仓库失败')
    toast.add({ title: errorMessage, color: 'error' })
  } finally {
    creatingRepo.value = false
  }
}

async function handleAddRepo() {
  if (!newRepoCode.value) return
  addingRepo.value = true
  try {
    await projectStore.linkRepo(projectId.value, newRepoCode.value)
    showAddRepoModal.value = false
    newRepoCode.value = ''
    createdRepoUrl.value = ''
  } finally {
    addingRepo.value = false
  }
}

async function handleRemoveRepo(repoProjectCode: string) {
  if (!confirm(`确定解除仓库 ${repoProjectCode} 的关联吗？`)) return
  await projectStore.unlinkRepo(projectId.value, repoProjectCode)
}

function openSecurityModal() {
  securityForm.value = {
    securityLevel: project.value?.securityLevel || 'company',
    accessWhitelist: [...(project.value?.accessWhitelist || [])]
  }
  showSecurityModal.value = true
}

async function handleSecuritySave() {
  securitySaving.value = true
  try {
    await projectStore.updateProject(projectId.value, {
      securityLevel: securityForm.value.securityLevel,
      accessWhitelist: securityForm.value.securityLevel === 'whitelist'
        ? securityForm.value.accessWhitelist
        : []
    })
    await projectStore.fetchProject(projectId.value)
    showSecurityModal.value = false
    toast.add({ title: '访问控制已更新', color: 'success' })
  } catch (err) {
    toast.add({
      title: getErrorMessage(err, '保存访问控制失败'),
      color: 'error',
      icon: 'i-lucide-circle-x'
    })
  } finally {
    securitySaving.value = false
  }
}

async function handleAddMember() {
  if (!newMemberUid.value) return
  addingMember.value = true
  try {
    await projectStore.addMember(projectId.value, newMemberUid.value, newMemberRole.value)
    showAddMemberModal.value = false
    newMemberUid.value = ''
    newMemberRole.value = 'member'
  } finally {
    addingMember.value = false
  }
}

function handleRemoveMemberClick(member: typeof members.value[0]) {
  const name = member.realName || member.uid
  operatingMember.value = { uid: member.uid, name, workItemCount: 0 }
  showRemoveMemberConfirm.value = true
}

async function confirmRemoveMember() {
  if (!operatingMember.value) return
  removingMember.value = true
  try {
    const result = await projectStore.removeMember(projectId.value, operatingMember.value.uid, 'remove')
    if (result.blocked) {
      showRemoveMemberConfirm.value = false
      operatingMember.value = { ...operatingMember.value, workItemCount: result.workItemCount || 0 }
      showSuspendMemberConfirm.value = true
    } else {
      showRemoveMemberConfirm.value = false
      operatingMember.value = null
    }
  } finally {
    removingMember.value = false
  }
}

async function confirmSuspendMember() {
  if (!operatingMember.value) return
  removingMember.value = true
  try {
    await projectStore.removeMember(projectId.value, operatingMember.value.uid, 'suspend')
    showSuspendMemberConfirm.value = false
    operatingMember.value = null
  } finally {
    removingMember.value = false
  }
}

function formatDate(date: string | null) {
  if (!date) return '-'
  return date.slice(0, 10)
}

async function onEditSaved() {
  await projectStore.fetchProject(projectId.value)
}
</script>

<template>
  <UDashboardPanel id="project-settings" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex flex-col h-full min-h-0">
        <ProjectNavbar class="shrink-0" />
        <div class="flex-1 min-h-0 overflow-y-auto pt-4 pb-12">
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- 左侧：基本信息（只读展示） -->
            <div class="space-y-6">
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <span class="font-semibold">基本信息</span>
                    <UButton
                      v-if="!isApprovalMode && isDraft"
                      icon="i-lucide-pencil"
                      label="编辑项目"
                      color="primary"
                      variant="soft"
                      size="sm"
                      @click="showEditModal = true"
                    />
                  </div>
                </template>
                <div class="space-y-3">
                  <div class="grid grid-cols-[100px_1fr] gap-x-4 gap-y-3 text-sm">
                    <span class="text-muted">项目名称</span>
                    <span class="font-medium">{{ project?.name || '-' }}</span>

                    <span class="text-muted">项目简称</span>
                    <span>{{ project?.shortName || '-' }}</span>

                    <span class="text-muted">项目编码</span>
                    <span class="font-mono">{{ project?.projectCode || '-' }}</span>

                    <span class="text-muted">内部代号</span>
                    <span>{{ project?.internalCode || '-' }}</span>

                    <span class="text-muted">项目描述</span>
                    <span class="whitespace-pre-wrap">{{ project?.description || '-' }}</span>

                    <span class="text-muted">项目类别</span>
                    <span>{{ categoryLabel }}</span>

                    <span class="text-muted">管理方法论</span>
                    <span>{{ methodologyLabel }}</span>

                    <span class="text-muted">所属项目集</span>
                    <span>{{ portfolioName }}</span>

                    <span class="text-muted">所属部门</span>
                    <span>{{ project?.deptCode || '-' }}</span>

                    <span class="text-muted">负责人</span>
                    <span>{{ leaderName }}</span>

                    <span class="text-muted">可见范围</span>
                    <span>
                      <UBadge
                        :color="(securityLevelConfig.color as any)"
                        variant="subtle"
                        size="xs"
                        :icon="securityLevelConfig.icon"
                      >
                        {{ securityLevelConfig.label }}
                      </UBadge>
                    </span>

                    <span v-if="project?.securityLevel === 'whitelist'" class="text-muted">白名单</span>
                    <span v-if="project?.securityLevel === 'whitelist'" class="break-all">{{ accessWhitelistLabel }}</span>

                    <span class="text-muted">业务领域</span>
                    <span>{{ domainName }}</span>

                    <span class="text-muted">客户编码</span>
                    <span>{{ project?.customerCode || '-' }}</span>

                    <span class="text-muted">客户名称</span>
                    <span>{{ project?.customerName || '-' }}</span>

                    <span class="text-muted">关联商机 ID</span>
                    <span>{{ project?.oppId ?? '-' }}</span>

                    <span class="text-muted">关联合同 ID</span>
                    <span>{{ project?.contractId ?? '-' }}</span>

                    <span class="text-muted">开始日期</span>
                    <span>{{ formatDate(project?.startDate ?? null) }}</span>

                    <span class="text-muted">结束日期</span>
                    <span>{{ formatDate(project?.endDate ?? null) }}</span>
                  </div>
                </div>
              </UCard>

              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <span class="font-semibold">成员</span>
                      <UBadge
                        color="neutral"
                        variant="subtle"
                        size="xs"
                      >
                        {{ members.length }}
                      </UBadge>
                    </div>
                    <UButton
                      v-if="canManageMembers && !isApprovalMode"
                      icon="i-lucide-user-plus"
                      label="添加成员"
                      color="primary"
                      variant="soft"
                      size="sm"
                      @click="showAddMemberModal = true"
                    />
                  </div>
                </template>

                <div
                  v-if="projectStore.loading"
                  class="flex justify-center py-8"
                >
                  <UIcon
                    name="i-lucide-loader-2"
                    class="size-6 animate-spin text-muted"
                  />
                </div>
                <div
                  v-else-if="members.length === 0"
                  class="text-center py-8 text-muted"
                >
                  <UIcon
                    name="i-lucide-users"
                    class="size-10 mx-auto mb-2"
                  />
                  <p class="text-sm">
                    暂无成员
                  </p>
                  <UButton
                    v-if="canManageMembers && !isApprovalMode"
                    label="添加成员"
                    color="primary"
                    variant="soft"
                    size="sm"
                    class="mt-3"
                    @click="showAddMemberModal = true"
                  />
                </div>
                <UTable
                  v-else
                  :data="members"
                  :columns="memberColumns"
                  class="w-full"
                >
                  <template #realName-cell="{ row }">
                    <div class="flex items-center gap-2">
                      <div
                        class="size-8 rounded-full flex items-center justify-center text-sm font-medium"
                        :class="row.original.status === 'suspended' ? 'bg-neutral/10 text-muted' : 'bg-primary/10 text-primary'"
                      >
                        {{ (row.original.realName || row.original.uid || '?').slice(0, 1) }}
                      </div>
                      <div class="min-w-0">
                        <div
                          class="font-medium truncate"
                          :class="row.original.status === 'suspended' ? 'text-muted line-through' : ''"
                        >
                          {{ row.original.realName || row.original.uid }}
                        </div>
                        <div
                          v-if="row.original.realName"
                          class="text-xs text-muted truncate"
                        >
                          {{ row.original.uid }}
                        </div>
                      </div>
                    </div>
                  </template>
                  <template #role-cell="{ row }">
                    <UBadge
                      :color="(PROJECT_ROLE_COLORS[row.original.role] as any)"
                      variant="subtle"
                      size="xs"
                    >
                      {{ PROJECT_ROLE_LABELS[row.original.role] || row.original.role }}
                    </UBadge>
                  </template>
                  <template #status-cell="{ row }">
                    <UBadge
                      :color="row.original.status === 'suspended' ? 'warning' : 'success'"
                      variant="subtle"
                      size="xs"
                    >
                      {{ row.original.status === 'suspended' ? '已暂停' : '正常' }}
                    </UBadge>
                  </template>
                  <template #joinedAt-cell="{ row }">
                    {{ formatDate(row.original.joinedAt) }}
                  </template>
                  <template #actions-cell="{ row }">
                    <UButton
                      v-if="canManageMembers && row.original.role !== 'manager'"
                      icon="i-lucide-user-minus"
                      color="error"
                      variant="ghost"
                      size="xs"
                      :title="row.original.status === 'suspended' ? '已暂停' : '移除成员'"
                      :disabled="row.original.status === 'suspended'"
                      @click.stop="handleRemoveMemberClick(row.original)"
                    />
                  </template>
                </UTable>
              </UCard>
            </div>

            <!-- 右侧：项目状态 + 关联仓库 + 危险区域 -->
            <div class="space-y-4">
              <UCard v-if="['product_dev', 'delivery', 'maintenance'].includes(project?.category || '')">
                <template #header>
                  <div class="flex items-center justify-between">
                    <span class="font-semibold">关联产品</span>
                    <UButton
                      icon="i-lucide-git-branch"
                      size="sm"
                      :color="canManageProducts ? 'primary' : 'neutral'"
                      variant="soft"
                      @click="navigateTo(`/projects/${projectId}/releases`)"
                    >
                      {{ canManageProducts ? '管理版本' : '查看版本' }}
                    </UButton>
                  </div>
                </template>
                <div v-if="productBindings.length === 0" class="text-sm text-muted py-4">
                  暂未关联产品，可在版本页添加产品关联。
                </div>
                <div v-else class="space-y-2">
                  <div
                    v-for="binding in productBindings"
                    :key="binding.id"
                    class="rounded-md border border-default p-3"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <div class="font-medium truncate">
                          {{ binding.product_name || binding.product_code }}
                        </div>
                        <div class="text-xs text-muted font-mono">
                          {{ binding.product_code }}
                        </div>
                      </div>
                      <UBadge
                        v-if="binding.is_primary"
                        color="primary"
                        variant="soft"
                        size="xs"
                      >
                        主产品
                      </UBadge>
                    </div>
                    <div class="mt-2 text-xs text-muted">
                      {{ binding.version_code ? `限定 ${binding.version_code}` : '全版本' }}
                    </div>
                  </div>
                </div>
              </UCard>

              <!-- 项目状态 -->
              <UCard v-if="project">
                <template #header>
                  <span class="font-semibold">项目状态</span>
                </template>
                <div class="space-y-4">
                  <!-- 生命周期状态 -->
                  <div class="flex items-center justify-between">
                    <span class="text-sm text-muted">生命周期</span>
                    <UBadge
                      :color="(projectStatusConfig[project.lifecycleStatus]?.color as any) || 'neutral'"
                      variant="soft"
                    >
                      <UIcon
                        :name="projectStatusConfig[project.lifecycleStatus]?.icon || 'i-lucide-circle'"
                        class="size-3.5 mr-1"
                      />
                      {{ projectStatusConfig[project.lifecycleStatus]?.label || project.lifecycleStatus }}
                    </UBadge>
                  </div>

                  <!-- 流程只读提示 -->
                  <div v-if="isWorkflowReadonly" class="rounded-lg bg-info/10 px-3 py-2 text-xs text-info">
                    审批流程进行中，部分操作受限
                  </div>
                </div>
              </UCard>

              <!-- 访问控制 -->
              <UCard v-if="project">
                <template #header>
                  <div class="flex items-center justify-between">
                    <span class="font-semibold">访问控制</span>
                    <UButton
                      v-if="!isApprovalMode"
                      label="设置"
                      icon="i-lucide-shield"
                      color="primary"
                      variant="soft"
                      size="xs"
                      @click="openSecurityModal"
                    />
                  </div>
                </template>
                <div class="space-y-3">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-sm text-muted">可见范围</span>
                    <UBadge
                      :color="(securityLevelConfig.color as any)"
                      variant="subtle"
                      :icon="securityLevelConfig.icon"
                    >
                      {{ securityLevelConfig.label }}
                    </UBadge>
                  </div>
                  <p class="text-xs text-muted">
                    {{ securityLevelConfig.description }}
                  </p>
                  <div
                    v-if="project.securityLevel === 'whitelist'"
                    class="rounded-md bg-elevated px-3 py-2 text-xs"
                  >
                    <div class="mb-1 text-muted">
                      白名单
                    </div>
                    <div class="break-all">
                      {{ accessWhitelistLabel }}
                    </div>
                  </div>
                </div>
              </UCard>

              <!-- 项目立项书 -->
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <span class="font-semibold">项目立项书</span>
                    <div class="flex items-center gap-1.5">
                      <UButton
                        label="管理"
                        icon="i-lucide-files"
                        color="neutral"
                        variant="soft"
                        size="xs"
                        :to="`/projects/${projectId}/documents`"
                      />
                      <UButton
                        v-if="!isApprovalMode && proposal"
                        label="变更"
                        icon="i-lucide-folder-sync"
                        color="secondary"
                        variant="subtle"
                        size="xs"
                        @click="openProposalChangeModal"
                      />
                    </div>
                  </div>
                </template>
                <div v-if="proposal" class="space-y-2">
                  <button
                    class="w-full flex items-center gap-3 px-3 py-2.5 rounded-md bg-elevated hover:bg-elevated/80 transition-colors text-left cursor-pointer"
                    @click="showProposalPreviewModal = true"
                  >
                    <UIcon name="i-lucide-file-text" class="size-5 text-primary shrink-0" />
                    <div class="min-w-0 flex-1">
                      <div class="text-sm font-medium truncate">
                        {{ proposal.title }}
                      </div>
                    </div>

                    <div class="text-xs text-muted">
                      点击查看
                    </div>
                  </button>
                </div>
                <div v-else class="text-center py-6">
                  <p class="text-sm text-muted mb-2">
                    暂未关联立项书
                  </p>
                  <UButton
                    v-if="!isApprovalMode"
                    icon="i-lucide-link"
                    label="关联立项书"
                    color="primary"
                    variant="soft"
                    size="xs"
                    @click="openProposalChangeModal"
                  />
                </div>
              </UCard>

              <!-- 里程碑信息 -->
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <span class="font-semibold">里程碑</span>
                    <span class="text-xs text-muted">{{ milestones.length }} 项</span>
                  </div>
                </template>
                <div v-if="milestones.length === 0" class="text-center py-6 text-sm text-muted">
                  暂无里程碑
                </div>
                <div v-else class="space-y-3">
                  <div
                    v-for="m in milestones"
                    :key="m.id"
                    class="rounded-lg border border-default p-3 space-y-2"
                  >
                    <div class="flex items-center gap-2 flex-wrap">
                      <UIcon name="i-lucide-flag" class="size-4 text-primary shrink-0" />
                      <span class="font-medium text-sm">{{ m.name }}</span>
                      <UBadge
                        v-if="m.pivrStage"
                        color="info"
                        variant="subtle"
                        size="xs"
                      >
                        {{ pivrStageLabel[m.pivrStage] || m.pivrStage }}
                      </UBadge>
                      <UBadge color="neutral" variant="outline" size="xs">
                        {{ m.status }}
                      </UBadge>
                      <span class="flex-1" />
                      <span class="text-xs text-muted font-mono">
                        {{ fmtDate(m.startDate) }} ~ {{ fmtDate(m.endDate) }}
                      </span>
                    </div>

                    <div v-if="m.description" class="text-xs text-muted">
                      {{ m.description }}
                    </div>

                    <div v-if="m.deliverables && m.deliverables.length > 0" class="pl-1">
                      <div class="text-xs text-muted mb-1">
                        交付物（{{ m.deliverables.length }}）
                      </div>
                      <div class="flex flex-wrap gap-1.5">
                        <UBadge
                          v-for="d in m.deliverables"
                          :key="d.name"
                          :color="(d.completed ? 'success' : d.required ? 'warning' : 'neutral') as any"
                          variant="subtle"
                          size="xs"
                        >
                          <UIcon
                            :name="d.completed ? 'i-lucide-check' : (d.required ? 'i-lucide-asterisk' : 'i-lucide-minus')"
                            class="size-3 mr-0.5"
                          />
                          {{ d.name }}
                        </UBadge>
                      </div>
                    </div>
                    <div v-else class="text-xs text-dimmed">
                      暂无交付物要求
                    </div>
                  </div>
                </div>
              </UCard>

              <!-- 关联仓库 -->
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <span class="font-semibold">关联仓库</span>
                    <UButton
                      v-if="!isApprovalMode"
                      icon="i-lucide-plus"
                      color="primary"
                      variant="soft"
                      size="xs"
                      @click="openAddRepoModal"
                    />
                  </div>
                </template>
                <div
                  v-if="repos.length === 0"
                  class="text-center py-6 text-sm text-muted"
                >
                  暂未关联任何仓库
                </div>
                <div
                  v-else
                  class="space-y-2"
                >
                  <div
                    v-for="repo in repos"
                    :key="repo.id"
                    class="flex items-center justify-between px-3 py-2 rounded-md bg-elevated"
                  >
                    <div class="min-w-0">
                      <div class="font-medium text-sm font-mono truncate">
                        <a
                          v-if="repoUrlMap.get(repo.repoProjectCode)"
                          :href="repoUrlMap.get(repo.repoProjectCode)"
                          target="_blank"
                          class="text-primary hover:underline"
                        >{{ repo.repoProjectCode }}</a>
                        <span v-else>{{ repo.repoProjectCode }}</span>
                      </div>
                      <!-- <div class="text-xs text-muted">
                        最后同步: {{ repo.lastSyncedAt ? formatDate(repo.lastSyncedAt) : '从未同步' }}
                      </div> -->
                    </div>
                    <UButton
                      icon="i-lucide-unlink"
                      color="error"
                      variant="ghost"
                      size="xs"
                      @click="handleRemoveRepo(repo.repoProjectCode)"
                    />
                  </div>
                </div>
              </UCard>

              <!-- 危险区域：仅草稿可删除 -->
              <UCard v-if="!isApprovalMode && isDraft">
                <template #header>
                  <span class="font-semibold text-error">危险区域</span>
                </template>
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="font-medium text-sm">
                      删除项目
                    </div>
                    <div class="text-xs text-muted">
                      仅草稿状态可删除，不可撤销
                    </div>
                  </div>
                  <UButton
                    label="删除"
                    color="error"
                    variant="soft"
                    size="sm"
                    @click="showDeleteConfirm = true"
                  />
                </div>
              </UCard>
            </div>
          </div>
        </div>

        <!-- 立项书预览弹窗 -->
        <UModal v-model:open="showProposalPreviewModal" :ui="{ content: 'sm:max-w-6xl', body: 'overflow-hidden p-0' }">
          <template #header>
            <span class="text-base font-medium">{{ proposal?.title || '立项书预览' }}</span>
          </template>
          <template #body>
            <div class="h-[70vh] rounded-lg border border-default bg-elevated/40 p-4 min-h-48">
              <AimsDocumentPreview
                v-if="proposal && showProposalPreviewModal"
                :source="proposal.documentSource || 'codocs'"
                :codocs-uuid="proposal.codocsUuid"
                :project-id="projectId"
                :repo-project-code="proposal.repoProjectCode"
                :repo-file-path="proposal.repoFilePath"
                :repo-commit-id="proposal.repoCommitId"
                :title="proposal.title"
              />
            </div>
          </template>
          <template #footer>
            <div class="flex justify-end">
              <UButton
                label="关闭"
                color="neutral"
                variant="soft"
                @click="showProposalPreviewModal = false"
              />
            </div>
          </template>
        </UModal>

        <!-- 变更立项书：统一文档选择器 -->
        <AimsDocumentPicker
          v-model:open="showProposalChangeModal"
          :title="proposal ? '变更立项书' : '关联立项书'"
          :dept-code="project?.deptCode || null"
          :aims-project-id="projectId"
          :repos="repos"
          :initial-value="proposalInitialValue"
          default-source="codocs_dept"
          mode="snapshot"
          @select="handleProposalSelected"
        />

        <!-- 编辑项目弹窗 -->
        <ProjectEditModal
          v-if="project"
          :open="showEditModal"
          :project="project"
          @update:open="showEditModal = $event"
          @saved="onEditSaved"
        />

        <!-- 添加成员弹窗 -->
        <UModal v-model:open="showAddMemberModal">
          <template #header>
            <h3 class="text-lg font-semibold">
              添加成员
            </h3>
          </template>
          <template #body>
            <div class="space-y-4 p-4">
              <UFormField
                label="用户"
                required
              >
                <USelectMenu
                  v-model="newMemberUid"
                  :items="userOptions"
                  value-key="value"
                  label-key="label"
                  placeholder="搜索姓名或 UID"
                  class="w-full"
                  searchable
                />
              </UFormField>
              <UFormField label="角色">
                <USelect
                  v-model="newMemberRole"
                  :items="PROJECT_ROLE_OPTIONS"
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
                @click="showAddMemberModal = false"
              />
              <UButton
                label="添加"
                color="primary"
                :loading="addingMember"
                @click="handleAddMember"
              />
            </div>
          </template>
        </UModal>

        <!-- 确认移除成员弹窗 -->
        <UModal v-model:open="showRemoveMemberConfirm">
          <template #header>
            <h3 class="text-lg font-semibold">
              确认移除成员
            </h3>
          </template>
          <template #body>
            <div class="p-4 text-sm">
              确定要移除成员 <strong>{{ operatingMember?.name }}</strong> 吗？此操作不可撤销。
            </div>
          </template>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                label="取消"
                color="neutral"
                variant="ghost"
                @click="showRemoveMemberConfirm = false"
              />
              <UButton
                label="确认移除"
                color="error"
                :loading="removingMember"
                @click="confirmRemoveMember"
              />
            </div>
          </template>
        </UModal>

        <!-- 暂停成员弹窗 -->
        <UModal v-model:open="showSuspendMemberConfirm">
          <template #header>
            <h3 class="text-lg font-semibold">
              无法直接移除
            </h3>
          </template>
          <template #body>
            <div class="p-4 space-y-3">
              <p class="text-sm">
                成员 <strong>{{ operatingMember?.name }}</strong> 名下有
                <strong class="text-primary">{{ operatingMember?.workItemCount }}</strong>
                个工作项，不可直接移除。
              </p>
              <p class="text-sm text-muted">
                您可以选择暂停该成员，暂停后该成员将不再出现在指派人选择列表中，但已有的工作项不受影响。
              </p>
            </div>
          </template>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                label="取消"
                color="neutral"
                variant="ghost"
                @click="showSuspendMemberConfirm = false"
              />
              <UButton
                label="确认暂停"
                color="warning"
                :loading="removingMember"
                @click="confirmSuspendMember"
              />
            </div>
          </template>
        </UModal>

        <!-- 访问控制设置弹窗 -->
        <UModal v-model:open="showSecurityModal" :ui="{ content: 'sm:max-w-lg' }">
          <template #header>
            <h3 class="text-lg font-semibold">
              访问控制设置
            </h3>
          </template>
          <template #body>
            <div class="space-y-4 p-4">
              <UFormField label="可见范围">
                <div class="space-y-3">
                  <USelect
                    v-model="securityForm.securityLevel"
                    :items="projectSecurityLevelOptions"
                    value-key="value"
                    class="w-full"
                  />
                  <p class="text-xs text-muted">
                    {{ selectedSecurityFormConfig.description }}
                  </p>
                </div>
              </UFormField>
              <UFormField
                v-if="securityForm.securityLevel === 'whitelist'"
                label="白名单"
              >
                <UserTreeSelector
                  v-model="securityAccessWhitelist"
                  placeholder="选择白名单用户"
                  width-class="w-full"
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
                @click="showSecurityModal = false"
              />
              <UButton
                label="保存"
                color="primary"
                :loading="securitySaving"
                @click="handleSecuritySave"
              />
            </div>
          </template>
        </UModal>

        <!-- 关联仓库弹窗 -->
        <UModal v-model:open="showAddRepoModal" :ui="{ content: 'sm:max-w-lg' }">
          <template #header>
            <h3 class="text-lg font-semibold">
              关联仓库
            </h3>
          </template>
          <template #body>
            <div class="space-y-4 p-4">
              <!-- 未设置 git 群组 -->
              <div v-if="!portfolioGitGroup" class="flex items-start gap-3 rounded-lg bg-warning/10 border border-warning/30 p-3">
                <UIcon name="i-lucide-triangle-alert" class="w-5 h-5 text-warning shrink-0 mt-0.5" />
                <div class="text-sm">
                  <p class="font-medium text-warning">
                    项目集未设置 Git 群组
                  </p>
                  <p class="text-muted mt-1">
                    请先在项目集设置中关联 GitLab 群组，再进行仓库关联。
                  </p>
                </div>
              </div>

              <!-- 已设置 git 群组 -->
              <template v-else>
                <div class="text-xs text-muted">
                  Git 群组: <span class="font-mono font-medium text-highlighted">{{ portfolioGitGroup }}</span>
                </div>

                <UFormField label="选择仓库" required>
                  <USelectMenu
                    v-model="newRepoCode"
                    :items="groupRepoOptions"
                    value-key="value"
                    placeholder="选择群组下的仓库"
                    searchable
                    :loading="groupReposLoading"
                    class="w-full"
                  />
                </UFormField>

                <!-- 创建后的仓库 URL -->
                <div v-if="createdRepoUrl" class="flex items-center gap-2 rounded-lg bg-success/10 border border-success/30 p-3">
                  <UIcon name="i-lucide-check-circle" class="w-4 h-4 text-success shrink-0" />
                  <div class="min-w-0 text-sm">
                    <span class="text-muted">仓库已创建: </span>
                    <a
                      :href="createdRepoUrl"
                      target="_blank"
                      class="text-primary hover:underline font-mono text-xs break-all"
                    >{{ createdRepoUrl }}</a>
                  </div>
                </div>

                <!-- 创建新仓库区域 -->
                <USeparator label="或" />

                <div v-if="!showCreateRepoForm">
                  <UButton
                    icon="i-lucide-plus"
                    label="在群组下创建新仓库"
                    color="neutral"
                    variant="soft"
                    size="sm"
                    block
                    @click="showCreateRepoForm = true"
                  />
                </div>
                <div v-else class="space-y-3 rounded-lg border border-default p-3">
                  <UFormField label="仓库名称" required>
                    <UInput
                      v-model="newRepoName"
                      placeholder="如：my-service"
                      class="w-full"
                    />
                  </UFormField>
                  <div class="text-xs text-muted">
                    完整路径: <span class="font-mono">{{ portfolioGitGroup }}/{{ newRepoName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || '...' }}</span>
                  </div>
                  <div class="text-xs text-muted">
                    仓库所有者: <span class="font-medium">{{ leaderName }}</span>
                  </div>
                  <div class="flex justify-end gap-2">
                    <UButton
                      label="取消"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      @click="showCreateRepoForm = false"
                    />
                    <UButton
                      label="创建仓库"
                      color="primary"
                      size="sm"
                      :loading="creatingRepo"
                      :disabled="!newRepoName.trim()"
                      @click="handleCreateRepo"
                    />
                  </div>
                </div>
              </template>
            </div>
          </template>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                label="取消"
                color="neutral"
                variant="ghost"
                @click="showAddRepoModal = false"
              />
              <UButton
                label="关联"
                color="primary"
                :loading="addingRepo"
                :disabled="!newRepoCode || !portfolioGitGroup"
                @click="handleAddRepo"
              />
            </div>
          </template>
        </UModal>

        <!-- 删除确认弹窗 -->
        <UModal v-model:open="showDeleteConfirm">
          <template #header>
            <h3 class="text-lg font-semibold">
              确认删除
            </h3>
          </template>
          <template #body>
            <div class="p-4">
              <p class="text-sm">
                确定要删除项目 <strong>{{ project?.name }}</strong> 吗？此操作不可撤销。
              </p>
            </div>
          </template>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                label="取消"
                color="neutral"
                variant="ghost"
                @click="showDeleteConfirm = false"
              />
              <UButton label="确认删除" color="error" @click="handleDelete" />
            </div>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
